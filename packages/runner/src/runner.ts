import { createHash, randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { harnessAdapter } from "./adapters.js";
import { cleanupVerificationSession } from "./verification.js";
import { activeSeconds, administrationRecords } from "./administration.js";
import { RunnerError, type HarnessInvocation, type RunPlan, type RunResult, type TerminationCause, type VerificationReport } from "./types.js";

interface CommandResult { readonly status: number | null; readonly signal: string | null; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean; readonly reportedCostUsd: number | null }
interface NetworkSession { readonly name: string; readonly proxyContainer: string | null }

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
  let reportedModelSpend: number | null = null;
  let networkSession: NetworkSession | null = null;

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
    chmodSync(inputDirectory, 0o555);
    capture("run-started", "runner", { startingCommit: actualStart, harness: plan.harness, budget: plan.budget });
    networkSession = createNetworkSession(plan);

    let harnessResult = invokeHarness(plan, workspace, adapter.createInvocation(plan, "/run-input/CHANGE.md"), capture, remainingMilliseconds(started, plan.budget.wallClockSeconds), networkSession.name);
    reportedModelSpend = addReportedSpend(reportedModelSpend, harnessResult.reportedCostUsd);
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
        if (verification.timedOut) {
          termination = "wall-clock-budget";
          break;
        }
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
        harnessResult = invokeHarness(plan, workspace, adapter.createInvocation(plan, `/run-input/RECOVERY-${recoveryAttemptsUsed}.md`), capture, remainingMilliseconds(started, plan.budget.wallClockSeconds), networkSession.name);
        reportedModelSpend = addReportedSpend(reportedModelSpend, harnessResult.reportedCostUsd);
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
        modelSpend: {
          mode: reportedModelSpend === null ? "unavailable" : "observed-after-run",
          amount: reportedModelSpend,
          currency: reportedModelSpend === null ? plan.budget.modelSpend.currency : "USD",
        },
      },
      submission: { patchPath: "submitted.patch", sha256 },
    };
    capture("budget-measured", "runner", result.budgetMeasurements);
    writeFileSync(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(join(output, "run.json"), `${JSON.stringify({ startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), plan }, null, 2)}\n`);
    return result;
  } finally {
    if (networkSession !== null) cleanupNetworkSession(networkSession);
    rmSync(workspace, { force: true, recursive: true });
    const inputDirectory = join(output, ".input");
    rmSync(join(output, ".verification"), { force: true, recursive: true });
    if (existsSync(inputDirectory)) chmodSync(inputDirectory, 0o755);
    rmSync(inputDirectory, { force: true, recursive: true });
  }
}

function invokeHarness(plan: RunPlan, workspace: string, invocation: HarnessInvocation, capture: (type: string, source: string, payload: unknown, fields?: Readonly<Record<string, unknown>> | null) => void, timeoutMilliseconds: number, networkName: string): CommandResult {
  const name = `change-two-${plan.runId.replace(/[^a-zA-Z0-9_.-]/g, "-")}`;
  if (process.getuid === undefined || process.getgid === undefined) throw new RunnerError("infrastructure", "Runner requires a POSIX host user.");
  const hostUser = `${process.getuid()}:${process.getgid()}`;
  const environmentArguments: string[] = [];
  for (const [key, value] of Object.entries({ ...plan.container.environment, ...invocation.environment })) environmentArguments.push("--env", `${key}=${value}`);
  for (const key of plan.container.credentialEnvironment) {
    if (process.env[key] === undefined) throw new RunnerError("input", `Declared credential environment variable is unavailable: ${key}`);
    environmentArguments.push("--env", key);
  }
  const credentialMountArguments: string[] = [];
  for (const mount of plan.container.credentialMounts ?? []) {
    const source = process.env[mount.sourceEnvironment];
    if (source === undefined) throw new RunnerError("input", `Declared credential mount environment variable is unavailable: ${mount.sourceEnvironment}`);
    const absoluteSource = resolve(source);
    if (!existsSync(absoluteSource)) throw new RunnerError("input", `Credential mount source does not exist: ${absoluteSource}`);
    const metadata = statSync(absoluteSource);
    if (!metadata.isDirectory() || metadata.uid !== process.getuid() || (metadata.mode & 0o777) !== 0o700) {
      throw new RunnerError("input", `Credential mount source must be a current-user directory with mode 0700: ${absoluteSource}`);
    }
    credentialMountArguments.push("--volume", `${absoluteSource}:${mount.target}`);
  }
  if (plan.container.network.mode === "controlled") {
    environmentArguments.push(
      "--env", "HTTP_PROXY=http://egress-proxy:3128",
      "--env", "HTTPS_PROXY=http://egress-proxy:3128",
      "--env", "NO_PROXY=127.0.0.1,localhost",
      "--env", "http_proxy=http://egress-proxy:3128",
      "--env", "https_proxy=http://egress-proxy:3128",
      "--env", "no_proxy=127.0.0.1,localhost",
      "--env", "NODE_USE_ENV_PROXY=1",
    );
  }
  const inputDirectory = join(resolve(workspace, ".."), ".input");

  const arguments_ = ["run", "--rm", "--name", name, "--user", hostUser, "--cpus", String(plan.container.cpus), "--memory", plan.container.memory, "--network", networkName, "--volume", `${workspace}:/submission`, "--volume", `${inputDirectory}:/run-input:ro`, ...credentialMountArguments, "--workdir", "/submission", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--env", "HOME=/tmp", ...environmentArguments, plan.container.image, ...invocation.command];
  capture("harness-started", "runner", { source: invocation.sourceName, command: invocation.command.slice(0, 3) });
  spawnSync("docker", ["rm", "--force", name], { encoding: "utf8" });
  const result = runCommand("docker", arguments_, timeoutMilliseconds);
  let reportedCostUsd: number | null = null;
  for (const stream of ["stdout", "stderr"] as const) {
    for (const line of result[stream].split("\n").filter(Boolean)) {
      const event = harnessAdapter(plan.harness.kind).normalizeLine(stream, line);
      capture(event.eventType, invocation.sourceName, event.payload, event.providerFields);
      reportedCostUsd = maximumReportedCost(reportedCostUsd, event.providerFields);
    }
  }
  if (result.timedOut) spawnSync("docker", ["rm", "--force", name], { encoding: "utf8" });
  return { ...result, reportedCostUsd };
}

function hasManualStop(plan: RunPlan): boolean {
  return plan.administrationPath !== undefined && administrationRecords(resolve(plan.administrationPath)).some((record) => record.recordType === "intervention" && record.category === "manual-budget-stop");
}

function runVisibleChecks(plan: RunPlan, workspace: string, capture: (type: string, source: string, payload: unknown) => void, started: bigint): { readonly passed: boolean; readonly failures: readonly string[]; readonly timedOut: boolean } {
  const publicRoot = resolve(plan.visibleVerification.publicRoot);
  const checkBundle = resolve(plan.visibleVerification.checkBundlePath);
  const reportDirectory = join(resolve(workspace, ".."), ".verification");
  mkdirSync(reportDirectory, { recursive: true });
  const reportPath = join(reportDirectory, `report-${process.hrtime.bigint()}.json`);
  capture("verification-started", "runner", { interface: "verification execute" });
  const result = runCommand(
    join(publicRoot, "change-two"),
    ["verification", "execute", workspace, checkBundle, reportPath],
    remainingMilliseconds(started, plan.budget.wallClockSeconds),
  );
  if (result.timedOut) {
    cleanupVerificationSession(reportPath);
    capture("verification-completed", "runner", { passed: false, timedOut: true });
    return { passed: false, failures: [], timedOut: true };
  }
  if (!existsSync(reportPath)) throw new RunnerError("infrastructure", `Verification CLI did not emit a report: ${result.stderr.trim()}`);
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as VerificationReport;
  if (report.schemaVersion !== "verification-report/v1" || !Array.isArray(report.checks)) throw new RunnerError("infrastructure", "Verification CLI emitted an invalid report.");
  if (report.error !== null && report.error.category !== "application") throw new RunnerError("infrastructure", `Verification ${report.error.category}: ${report.error.diagnostic}`);
  const failures: string[] = [];
  for (const check of report.checks) {
    capture("visible-verification", "runner", check);
    if (check.status !== "passed") failures.push(`${check.checkId}\n${check.diagnostics.join("\n")}`);
  }
  capture("verification-completed", "runner", { passed: report.passed, timedOut: false });
  return { passed: report.passed && failures.length === 0, failures, timedOut: false };
}
function createNetworkSession(plan: RunPlan): NetworkSession {
  if (plan.container.network.mode === "none") return { name: "none", proxyContainer: null };
  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const name = `change-two-run-${suffix}`;
  const proxyContainer = `${name}-proxy`;
  const label = `change-two.runner-network=${suffix}`;
  runChecked("docker", ["network", "create", "--internal", "--label", label, name], undefined, "infrastructure");
  try {
    runChecked("docker", [
      "run", "--detach", "--name", proxyContainer, "--label", label,
      "--network", "bridge", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--env", `ALLOWED_HOSTS=${plan.container.network.allowedHosts.join(",")}`,
      plan.container.image, "node", "/runtime/egress-proxy.mjs",
    ], undefined, "infrastructure");
    runChecked("docker", ["network", "connect", "--alias", "egress-proxy", name, proxyContainer], undefined, "infrastructure");
    return { name, proxyContainer };
  } catch (error) {
    cleanupNetworkSession({ name, proxyContainer });
    throw error;
  }
}

function cleanupNetworkSession(session: NetworkSession): void {
  if (session.proxyContainer !== null) runCommand("docker", ["rm", "--force", session.proxyContainer]);
  if (session.name !== "none") runCommand("docker", ["network", "rm", session.name]);
}


function validatePlan(plan: RunPlan): void {
  if (plan.schemaVersion !== "runner/v1") throw new RunnerError("input", "Unsupported runner schemaVersion.");
  if (!/^[a-f0-9]{40}$/.test(plan.startingCommit)) throw new RunnerError("input", "startingCommit must be a full lowercase Git commit.");
  if (plan.budget.wallClockSeconds < 1 || plan.budget.recoveryAttempts < 0) throw new RunnerError("input", "Budget values are invalid.");
  if (plan.container.cpus <= 0 || plan.container.memory.length === 0 || plan.container.image.length === 0) throw new RunnerError("input", "Container policy is incomplete.");
  if (plan.visibleVerification === undefined || plan.visibleVerification.publicRoot.length === 0 || plan.visibleVerification.checkBundlePath.length === 0) throw new RunnerError("input", "Visible verification interface is incomplete.");
  const credentialTargets = new Set<string>();
  for (const mount of plan.container.credentialMounts ?? []) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(mount.sourceEnvironment)) throw new RunnerError("input", `Invalid credential mount environment name: ${mount.sourceEnvironment}`);
    if (!/^\/run-credentials\/[a-z0-9][a-z0-9-]*$/.test(mount.target)) throw new RunnerError("input", `Invalid credential mount target: ${mount.target}`);
    if (credentialTargets.has(mount.target)) throw new RunnerError("input", `Duplicate credential mount target: ${mount.target}`);
    credentialTargets.add(mount.target);
  }
  if (plan.container.network.mode === "controlled") {
    if (plan.container.network.allowedHosts.length === 0 || new Set(plan.container.network.allowedHosts).size !== plan.container.network.allowedHosts.length) throw new RunnerError("input", "Controlled network allowedHosts must be non-empty and unique.");
    for (const host of plan.container.network.allowedHosts) {
      if (host === "localhost" || /^[0-9.]+$/.test(host) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.includes("..")) throw new RunnerError("input", `Invalid controlled network host: ${host}`);
    }
  } else if (plan.harness.kind !== "synthetic") {
    throw new RunnerError("input", "Agent harnesses require a controlled network.");
  }
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
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "", timedOut: timeout !== undefined && (result.status === 124 || result.status === 137 || result.signal === "SIGKILL"), reportedCostUsd: null };
}

function maximumReportedCost(current: number | null, fields: Readonly<Record<string, unknown>> | null): number | null {
  if (fields === null) return current;
  let found = current;
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    for (const [key, nested] of Object.entries(value)) {
      if ((key === "total_cost_usd" || key === "cost_usd") && typeof nested === "number" && Number.isFinite(nested) && nested >= 0) {
        found = found === null ? nested : Math.max(found, nested);
      } else {
        visit(nested);
      }
    }
  };
  visit(fields);
  return found;
}

function addReportedSpend(total: number | null, invocation: number | null): number | null {
  if (invocation === null) return total;
  return (total ?? 0) + invocation;
}
