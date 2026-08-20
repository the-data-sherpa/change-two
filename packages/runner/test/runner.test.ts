import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { activeSeconds, administrationRecords, correctTimer, recordIntervention, startTimer, stopTimer } from "../src/administration.js";
import { harnessAdapter } from "../src/adapters.js";
import { executeRun } from "../src/runner.js";
import { RunnerError, type RunPlan, type RunResult } from "../src/types.js";

const NODE_IMAGE = "node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03";
const HAS_INTEGRATION_TOOLS = ["docker", "git"].every((command) => {
  const result = execFileSync("sh", ["-c", `command -v ${command} || true`], { encoding: "utf8" });
  return result.trim().length > 0;
});


interface Fixture {
  readonly root: string;
  readonly repository: string;
  readonly requirement: string;
  readonly commit: string;
  readonly publicRoot: string;
  readonly checkBundle: string;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "change-two-runner-"));
  const repository = join(root, "repository");
  execFileSync("git", ["init", "--quiet", repository]);
  execFileSync("git", ["-C", repository, "config", "user.email", "runner@example.test"]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Runner Fixture"]);
  writeFileSync(join(repository, "README.md"), "fixture\n");
  execFileSync("git", ["-C", repository, "add", "README.md"]);
  execFileSync("git", ["-C", repository, "commit", "--quiet", "-m", "fixture"]);
  const requirement = join(root, "change.md");
  writeFileSync(requirement, "Create result.txt.\n");
  writeFileSync(join(root, "parent-secret"), "must not be mounted\n");
  const publicRoot = join(root, "public");
  const checkBundle = join(root, "checks");
  mkdirSync(publicRoot);
  mkdirSync(checkBundle);
  writeFileSync(join(checkBundle, "bundle.json"), JSON.stringify({ schemaVersion: "verification-bundle/v1", entrypoint: "checks.mjs", checks: [{ checkId: "check:result", title: "Result" }] }));
  const verifier = join(publicRoot, "change-two");
  writeFileSync(verifier, `#!/usr/bin/env node
const fs = require("node:fs");
const [, , group, command, workspace, bundle, output] = process.argv;
if (group !== "verification" || command !== "execute" || !fs.existsSync(bundle) || fs.existsSync(workspace + "/visible-checks.json")) process.exit(2);
const applicationError = fs.existsSync(workspace + "/application-error");
const passed = !applicationError && fs.existsSync(workspace + "/result.txt") && fs.readFileSync(workspace + "/result.txt", "utf8") === "implemented";
const checks = [{ checkId: "check:result", status: applicationError ? "error" : passed ? "passed" : "failed", diagnostics: passed ? [] : [applicationError ? "submitted application did not start" : "expected implemented"], evidence: [{ kind: "fixture" }] }];
fs.writeFileSync(output, JSON.stringify({ schemaVersion: "verification-report/v1", passed, error: applicationError ? { category: "application", diagnostic: "submitted application did not start" } : null, checks }));
process.exit(applicationError ? 2 : passed ? 0 : 1);
`);
  chmodSync(verifier, 0o755);
  return { root, repository, requirement, commit: execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), publicRoot, checkBundle };
}

function plan(f: Fixture, command: readonly string[], overrides: Partial<RunPlan> = {}): RunPlan {
  return {
    schemaVersion: "runner/v1",
    runId: "run:synthetic",
    sourceRepository: f.repository,
    startingCommit: f.commit,
    requirementPath: f.requirement,
    visibleVerification: { publicRoot: f.publicRoot, checkBundlePath: f.checkBundle },
    harness: { kind: "synthetic", version: "1.0.0", model: "synthetic", tools: ["shell"], permissions: ["workspace-write"], syntheticCommand: command },
    policy: { mode: "minimal", allowedInterventions: ["safety-stop", "independent-infrastructure-failure"] },
    budget: { wallClockSeconds: 10, operatorActiveSeconds: 60, reviewerActiveSeconds: 60, recoveryAttempts: 0, modelSpend: { currency: "USD", maximum: 1, measurementMode: "unavailable" } },
    container: { image: NODE_IMAGE, network: { mode: "none" }, cpus: 1, memory: "256m", environment: {}, credentialEnvironment: [] },
    ...overrides,
  };
}

test("isolates inputs, normalizes provenance, and finalizes an immutable submission", { skip: !HAS_INTEGRATION_TOOLS }, () => {
  const f = fixture();
  process.env.UNDECLARED_SECRET = "not-forwarded";
  const credentialHome = join(f.root, "credential-home");
  mkdirSync(credentialHome, { mode: 0o700 });
  writeFileSync(join(credentialHome, "auth.json"), "credential fixture\n", { mode: 0o600 });
  process.env.TEST_CREDENTIAL_HOME = credentialHome;
  const output = join(f.root, "output");
  const basePlan = plan(f, ["true"]);
  const runPlan = plan(
    f,
    ["sh", "-c", "test -f /run-input/CHANGE.md && test ! -w /run-input && test ! -e /run-input/visible-checks.json && test ! -e /parent-secret && test -z \"${UNDECLARED_SECRET:-}\" && test \"$(cat /run-credentials/test/auth.json)\" = \"credential fixture\" && printf '{\"type\":\"result\",\"total_cost_usd\":0.42}\\n' && printf implemented > result.txt"],
    { container: { ...basePlan.container, credentialMounts: [{ sourceEnvironment: "TEST_CREDENTIAL_HOME", target: "/run-credentials/test" }] } },
  );
  const planPath = join(f.root, "plan.json");
  writeFileSync(planPath, JSON.stringify(runPlan));
  const result = JSON.parse(execFileSync("./change-two", ["runner", "execute", planPath, output], { cwd: process.cwd(), encoding: "utf8" })) as RunResult;
  assert.equal(result.terminationCause, "success");
  assert.equal(result.workingTreeDirty, true);
  assert.deepEqual(result.budgetMeasurements.modelSpend, { mode: "observed-after-run", amount: 0.42, currency: "USD" });
  const submittedPatch = readFileSync(join(output, "submitted.patch"), "utf8");
  assert.match(submittedPatch, /^diff --git a\/result\.txt b\/result\.txt/m);
  assert.equal(submittedPatch.includes("CHANGE.md"), false);
  const events = readFileSync(join(output, "capture.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { eventType: string; source: { name: string; providerFields: unknown } });
  assert.ok(events.some((event) => event.eventType === "provider-event" && event.source.name === "synthetic@1.0.0" && event.source.providerFields !== null));
  assert.throws(() => executeRun(plan(f, ["true"]), output), /Output already exists/);
  delete process.env.TEST_CREDENTIAL_HOME;
});

test("returns visible failures for recovery and finalizes recovery exhaustion without repair", { skip: !HAS_INTEGRATION_TOOLS }, () => {
  const f = fixture();
  const exhausted = executeRun(plan(f, ["sh", "-c", "printf broken > result.txt"]), join(f.root, "exhausted"));
  assert.equal(exhausted.terminationCause, "verification-exhausted");
  assert.deepEqual(exhausted.budgetMeasurements.modelSpend, { mode: "unavailable", amount: null, currency: "USD" });
  assert.match(readFileSync(join(f.root, "exhausted", "submitted.patch"), "utf8"), /broken/);
  assert.match(readFileSync(join(f.root, "exhausted", "capture.jsonl"), "utf8"), /expected implemented/);

  const recoveredPlan = plan(f, ["sh", "-c", "if test -f attempt; then printf implemented > result.txt; else touch attempt; printf broken > result.txt; fi"], { budget: { ...plan(f, ["true"]).budget, recoveryAttempts: 1 } });
  const recovered = executeRun(recoveredPlan, join(f.root, "recovered"));
  assert.equal(recovered.terminationCause, "success");
  assert.equal(recovered.recoveryAttemptsUsed, 1);
  const applicationPlan = plan(
    f,
    ["sh", "-c", "if test -f attempt; then rm application-error; printf implemented > result.txt; else touch attempt application-error; fi"],
    { budget: { ...plan(f, ["true"]).budget, recoveryAttempts: 1 } },
  );
  const applicationRecovered = executeRun(applicationPlan, join(f.root, "application-recovered"));
  assert.equal(applicationRecovered.terminationCause, "success");
  assert.equal(applicationRecovered.recoveryAttemptsUsed, 1);
});


test("distinguishes adapter failure and wall-clock budget termination", { skip: !HAS_INTEGRATION_TOOLS }, () => {
  const f = fixture();
  assert.equal(executeRun(plan(f, ["sh", "-c", "exit 23"]), join(f.root, "failed")).terminationCause, "adapter-failure");
  const timeoutPlan = plan(f, ["sleep", "5"], { budget: { ...plan(f, ["true"]).budget, wallClockSeconds: 1 } });
  assert.equal(executeRun(timeoutPlan, join(f.root, "timeout")).terminationCause, "wall-clock-budget");
});

test("Claude Code and Codex adapters pin versions and retain unavailable usage", () => {
  const f: Fixture = { root: "/tmp", repository: "/tmp/repository", requirement: "/tmp/change.md", commit: "a".repeat(40), publicRoot: "/tmp/public", checkBundle: "/tmp/checks" };
  const base = plan(f, ["true"]);
  const claude = harnessAdapter("claude-code").createInvocation({ ...base, harness: { ...base.harness, kind: "claude-code", version: "2.1.226", model: "claude-sonnet" } }, "/run-input/CHANGE.md");
  const codex = harnessAdapter("codex").createInvocation({ ...base, harness: { ...base.harness, kind: "codex", version: "0.147.0", model: "gpt-5.4" } }, "/run-input/CHANGE.md");
  assert.equal(claude.command[0], "/runtime/packages/runner/node_modules/.bin/claude");
  assert.throws(() => harnessAdapter("claude-code").createInvocation({ ...base, harness: { ...base.harness, kind: "claude-code", version: "latest", model: "claude-sonnet" } }, "/run-input/CHANGE.md"), /pinned/);
  assert.throws(() => harnessAdapter("codex").createInvocation({ ...base, harness: { ...base.harness, kind: "codex", version: "latest", model: "gpt-5.4" } }, "/run-input/CHANGE.md"), /pinned/);
  assert.equal(codex.command[0], "/runtime/packages/runner/node_modules/.bin/codex");
  assert.equal(base.budget.modelSpend.measurementMode, "unavailable");
});

test("manual Budget stop records an Intervention and finalizes the current state", { skip: !HAS_INTEGRATION_TOOLS }, async () => {
  const f = fixture();
  const admin = join(f.root, "administration.jsonl");
  const output = join(f.root, "manual-stop");
  const runPlan = plan(f, ["sh", "-c", "printf partial > result.txt; sleep 30"], { administrationPath: admin });
  const planPath = join(f.root, "manual-stop-plan.json");
  writeFileSync(planPath, JSON.stringify(runPlan));
  const child = spawn("./change-two", ["runner", "execute", planPath, output], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  const containerName = "change-two-run-synthetic";
  execFileSync("sh", ["-c", `until docker inspect ${containerName} >/dev/null 2>&1; do :; done`], { timeout: 10_000 });
  execFileSync("./change-two", ["runner", "intervene", planPath, admin, "operator:a", "manual-budget-stop", "Stop at the declared budget.", "Budget owner decision."], { cwd: process.cwd() });
  const completion = Promise.withResolvers<number | null>();
  child.once("close", completion.resolve);
  const exitCode = await completion.promise;
  assert.equal(exitCode, 0);
  const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8")) as RunResult;
  assert.equal(result.terminationCause, "manual-budget-stop");
  assert.match(readFileSync(join(output, "submitted.patch"), "utf8"), /partial/);
});

test("policy validation, timers, corrections, and manual stops remain append-only", () => {
  const f: Fixture = { root: mkdtempSync(join(tmpdir(), "change-two-admin-")), repository: "/tmp/repository", requirement: "/tmp/change.md", commit: "a".repeat(40), publicRoot: "/tmp/public", checkBundle: "/tmp/checks" };
  const p = plan(f, ["true"]);
  const admin = join(f.root, "administration.jsonl");
  assert.throws(() => recordIntervention(admin, p, "operator:a", "test-request", "run tests", "needed"), RunnerError);
  assert.throws(() => recordIntervention(admin, p, "operator:a", "safety-stop", "stop", null), RunnerError);
  recordIntervention(admin, p, "operator:a", "safety-stop", "stop", "unsafe output");
  recordIntervention(admin, p, "operator:a", "manual-budget-stop", "manual stop", "budget owner decision");
  const started = startTimer(admin, "reviewer:a", "reviewer");
  stopTimer(admin, started.intervalId, "reviewer:a");
  correctTimer(admin, started.intervalId, "reviewer:a", 12.5, "timer started late");
  assert.equal(activeSeconds(admin, "reviewer"), 12.5);
  assert.equal(administrationRecords(admin).length, 5);
});
