import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { harnessAdapter } from "./adapters.js";
import { activeSeconds, administrationRecords } from "./administration.js";
import { RunnerError, type HarnessInvocation, type RunPlan, type RunResult, type TerminationCause } from "./types.js";

interface CommandResult { readonly status: number | null; readonly signal: string | null; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean }

export function executeRun(plan: RunPlan, outputDirectory: string): RunResult {
  validatePlan(plan);
  const output = resolve(outputDirectory);
  if (existsSync(output)) throw new RunnerError("input", `Output already exists: ${output}`);
  mkdirSync(output, { recursive: true });
  const workspace = join(output, ".workspace");
  const capturePath = join(output, "capture.jsonl");
  let sequence = 0;
  const started = process.hrtime.bigint();
  const startedAt = new Date();
  const adapter = harnessAdapter(plan.harness.kind);
  let termination: TerminationCause = "adapter-failure";
  let recoveryAttemptsUsed = 0;
  let operatorActiveSeconds = 0;
  let reviewerActiveSeconds = 0;

  const capture = (eventType: string, source: string, payload: unknown, providerFields: Readonly<Record<string, unknown>> | null = null): void => {
    sequence += 1;
    const event = {
      schemaType: "capture-event",
      schemaVersion: "evidence/v1",
      eventId: `event:${plan.runId.replace(/[^a-z0-9._-]/g, "-")}-${sequence}`,
      runId: plan.runId,
      sequence,
      timestamp: new Date().toISOString(),
      elapsedNanoseconds: Number(process.hrtime.bigint() - started),
      source: { kind: source === "runner" ? "harness" : "provider", name: source, providerEventId: null, providerFields },
      eventType,
      sanitization: "raw",
      payload,
    };
    writeFileSync(capturePath, `${JSON.stringify(event)}\n`, { flag: "a" });
  };

  try {
    runChecked("git", ["clone", "--no-checkout", "--no-local", plan.sourceRepository, workspace], undefined, "infrastructure");
    runChecked("git", ["-C", workspace, "checkout", "--detach", plan.startingCommit], undefined, "input");
    const actualStart = git(workspace, ["rev-parse", "HEAD"]).trim();
    if (actualStart !== plan.startingCommit) throw new RunnerError("input", `Starting commit mismatch: expected ${plan.startingCommit}, got ${actualStart}.`);

    const inputDirectory = join(output, ".input");
    mkdirSync(inputDirectory);
    const requirementSource = resolve(plan.requirementPath);
    if (!existsSync(requirementSource)) throw new RunnerError("input", `Requirement does not exist: ${requirementSource}`);
    copyFileSync(requirementSource, join(inputDirectory, "CHANGE.md"));
    writeFileSync(join(inputDirectory, "visible-checks.json"), `${JSON.stringify(plan.visibleChecks, null, 2)}\n`);
    chmodSync(inputDirectory, 0o555);
    capture("run-started", "runner", { startingCommit: actualStart, harness: plan.harness, budget: plan.budget });

    let harnessResult = invokeHarness(plan, workspace, adapter.createInvocation(plan, "/run-input/CHANGE.md"), capture, remainingMilliseconds(started, plan.budget.wallClockSeconds));
    if (plan.administrationPath !== undefined) {
      for (const record of administrationRecords(resolve(plan.administrationPath))) capture(record.recordType, "runner", record);
    }
    if (hasManualStop(plan)) {
      termination = "manual-budget-stop";
    } else if (harnessResult.timedOut) {
      termination = "wall-clock-budget";
    } else if (harnessResult.status !== 0) {
      termination = "adapter-failure";
    } else {
      while (true) {
        const verification = runVisibleChecks(plan, workspace, capture, started);
        if (verification.passed) {
          termination = "success";
          break;
        }
        if (recoveryAttemptsUsed >= plan.budget.recoveryAttempts) {
          termination = "verification-exhausted";
          break;
        }
        recoveryAttemptsUsed += 1;
        capture("recovery-started", "runner", { attempt: recoveryAttemptsUsed, failures: verification.failures });
        const promptFile = join(inputDirectory, `RECOVERY-${recoveryAttemptsUsed}.md`);
        chmodSync(inputDirectory, 0o755);
        writeFileSync(promptFile, `Visible verification failed. Fix only the submitted implementation.\n\n${verification.failures.join("\n\n")}\n`);
        chmodSync(inputDirectory, 0o555);
        harnessResult = invokeHarness(plan, workspace, adapter.createInvocation(plan, `/run-input/RECOVERY-${recoveryAttemptsUsed}.md`), capture, remainingMilliseconds(started, plan.budget.wallClockSeconds));
        if (hasManualStop(plan)) { termination = "manual-budget-stop"; break; }
        if (harnessResult.timedOut) { termination = "wall-clock-budget"; break; }
        if (harnessResult.status !== 0) { termination = "adapter-failure"; break; }
      }
    }
    capture("termination", "runner", { cause: termination, recoveryAttemptsUsed, status: harnessResult.status, signal: harnessResult.signal });

    const submittedCommit = git(workspace, ["rev-parse", "HEAD"]).trim();
    runChecked("git", ["-C", workspace, "add", "--intent-to-add", "."], undefined, "infrastructure");
    const patch = git(workspace, ["diff", "--binary", "HEAD"]);
    const patchPath = join(output, "submitted.patch");
    writeFileSync(patchPath, patch);
    const dirty = patch.length > 0;
    const sha256 = createHash("sha256").update(patch).digest("hex");
    capture("submission-finalized", "runner", { startingCommit: plan.startingCommit, submittedCommit, workingTreeDirty: dirty, patchPath: "submitted.patch", sha256 });

    const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    if (plan.administrationPath !== undefined) {
      operatorActiveSeconds = activeSeconds(resolve(plan.administrationPath), "operator");
      reviewerActiveSeconds = activeSeconds(resolve(plan.administrationPath), "reviewer");
    }
    const result: RunResult = {
      runId: plan.runId,
      startingCommit: plan.startingCommit,
      submittedCommit,
      workingTreeDirty: dirty,
      terminationCause: termination,
      recoveryAttemptsUsed,
      budgetMeasurements: {
        wallClock: { mode: "enforced", seconds: elapsedSeconds },
        operatorActive: { mode: "enforced", seconds: operatorActiveSeconds },
        reviewerActive: { mode: "enforced", seconds: reviewerActiveSeconds },
        modelSpend: { mode: plan.budget.modelSpend.measurementMode, amount: null, currency: plan.budget.modelSpend.currency },
      },
      submission: { patchPath: "submitted.patch", sha256 },
    };
    writeFileSync(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(join(output, "run.json"), `${JSON.stringify({ startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), plan }, null, 2)}\n`);
    return result;
  } finally {
    rmSync(workspace, { force: true, recursive: true });
    const inputDirectory = join(output, ".input");
    if (existsSync(inputDirectory)) chmodSync(inputDirectory, 0o755);
    rmSync(inputDirectory, { force: true, recursive: true });
  }
}

function invokeHarness(plan: RunPlan, workspace: string, invocation: HarnessInvocation, capture: (type: string, source: string, payload: unknown, fields?: Readonly<Record<string, unknown>> | null) => void, timeoutMilliseconds: number): CommandResult {
  const name = `change-two-${plan.runId.replace(/[^a-zA-Z0-9_.-]/g, "-")}`;
  const environmentArguments: string[] = [];
  for (const [key, value] of Object.entries({ ...plan.container.environment, ...invocation.environment })) environmentArguments.push("--env", `${key}=${value}`);
  for (const key of plan.container.credentialEnvironment) {
    const value = process.env[key];
    if (value === undefined) throw new RunnerError("input", `Declared credential environment variable is unavailable: ${key}`);
    environmentArguments.push("--env", `${key}=${value}`);
  }
  const inputDirectory = join(resolve(workspace, ".."), ".input");
  const arguments_ = ["run", "--rm", "--name", name, "--cpus", String(plan.container.cpus), "--memory", plan.container.memory, "--network", plan.container.network, "--volume", `${workspace}:/workspace`, "--volume", `${inputDirectory}:/run-input:ro`, "--workdir", "/workspace", ...environmentArguments, plan.container.image, ...invocation.command];
  capture("harness-started", "runner", { source: invocation.sourceName, command: invocation.command.slice(0, 3) });
  spawnSync("docker", ["rm", "--force", name], { encoding: "utf8" });
  const result = runCommand("docker", arguments_, timeoutMilliseconds);
  for (const stream of ["stdout", "stderr"] as const) {
    for (const line of result[stream].split("\n").filter(Boolean)) {
      const event = harnessAdapter(plan.harness.kind).normalizeLine(stream, line);
      capture(event.eventType, invocation.sourceName, event.payload, event.providerFields);
    }
  }
  if (result.timedOut) spawnSync("docker", ["rm", "--force", name], { encoding: "utf8" });
  return result;
}

function hasManualStop(plan: RunPlan): boolean {
  return plan.administrationPath !== undefined && administrationRecords(resolve(plan.administrationPath)).some((record) => record.recordType === "intervention" && record.category === "manual-budget-stop");
}

function runVisibleChecks(plan: RunPlan, workspace: string, capture: (type: string, source: string, payload: unknown) => void, started: bigint): { readonly passed: boolean; readonly failures: readonly string[] } {
  const failures: string[] = [];
  for (const check of plan.visibleChecks) {
    const result = runCommand("docker", ["run", "--rm", "--network", "none", "--volume", `${workspace}:/workspace`, "--workdir", "/workspace", plan.container.image, ...check.command], remainingMilliseconds(started, plan.budget.wallClockSeconds));
    const passed = result.status === 0 && !result.timedOut;
    capture("visible-verification", "runner", { checkId: check.checkId, passed, status: result.status, stdout: result.stdout, stderr: result.stderr });
    if (!passed) failures.push(`${check.checkId}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return { passed: failures.length === 0, failures };
}

function validatePlan(plan: RunPlan): void {
  if (plan.schemaVersion !== "runner/v1") throw new RunnerError("input", "Unsupported runner schemaVersion.");
  if (!/^[a-f0-9]{40}$/.test(plan.startingCommit)) throw new RunnerError("input", "startingCommit must be a full lowercase Git commit.");
  if (plan.budget.wallClockSeconds < 1 || plan.budget.recoveryAttempts < 0) throw new RunnerError("input", "Budget values are invalid.");
  if (plan.container.cpus <= 0 || plan.container.memory.length === 0 || plan.container.image.length === 0) throw new RunnerError("input", "Container policy is incomplete.");
  if (plan.visibleChecks.length === 0) throw new RunnerError("input", "At least one Visible Check is required.");
}

function remainingMilliseconds(started: bigint, budgetSeconds: number): number {
  const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1e6;
  return Math.max(1, Math.floor(budgetSeconds * 1000 - elapsedMilliseconds));
}

function git(workspace: string, arguments_: readonly string[]): string {
  return runChecked("git", ["-C", workspace, ...arguments_], undefined, "infrastructure").stdout;
}

function runChecked(command: string, arguments_: readonly string[], timeout: number | undefined, category: RunnerError["category"]): CommandResult {
  const result = runCommand(command, arguments_, timeout);
  if (result.status !== 0) throw new RunnerError(category, `${command} failed (${result.status ?? result.signal ?? "unknown"}): ${result.stderr.trim()}`);
  return result;
}

function runCommand(command: string, arguments_: readonly string[], timeout?: number): CommandResult {
  const executable = timeout === undefined ? command : "timeout";
  const effectiveArguments = timeout === undefined ? arguments_ : ["--signal=KILL", `${timeout / 1000}s`, command, ...arguments_];
  const result = spawnSync(executable, effectiveArguments, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "", timedOut: timeout !== undefined && (result.status === 124 || result.status === 137 || result.signal === "SIGKILL") };
}
