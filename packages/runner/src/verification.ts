import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { RunnerError, type VerificationReport } from "./types.js";

interface BundleManifest { readonly schemaVersion: "verification-bundle/v1"; readonly entrypoint: string; readonly checks: readonly { readonly checkId: string; readonly title: string }[] }
interface ProcessResult { readonly status: number | null; readonly stdout: string; readonly stderr: string }
class VerificationOperationalError extends Error {
  constructor(
    readonly category: "application",
    message: string,
  ) {
    super(message);
    this.name = "VerificationOperationalError";
  }
}


export function executeVerification(workspacePath: string, checkBundlePath: string, outputPath: string, publicRootPath: string): VerificationReport {
  const workspace = requireDirectory(workspacePath, "Submitted workspace");
  const checkBundle = requireDirectory(checkBundlePath, "Check bundle");
  const publicRoot = requireDirectory(publicRootPath, "Public repository root");
  const output = resolve(outputPath);
  if (existsSync(output)) throw new RunnerError("input", `Verification output already exists: ${output}`);
  if (!existsSync(dirname(output))) throw new RunnerError("input", `Verification output parent does not exist: ${dirname(output)}`);
  let manifest: BundleManifest;
  try { manifest = readManifest(checkBundle); }
  catch (error) { const report = operationalReport([], "bundle", diagnostic(error)); writeReport(output, report); return report; }

  const initialDigest = directoryDigest(workspace);
  const nonce = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const label = `change-two.verification=${verificationSession(output)}`;
  const network = `change-two-verification-${nonce}`;
  const postgres = `${network}-postgres`;
  const application = `${network}-app`;
  const checker = `${network}-checker`;
  const temporary = mkdtempSync(join(tmpdir(), "change-two-verification-"));
  let report: VerificationReport;
  try {
    const toolchain = readToolchain(publicRoot);
    const image = verifierImage(publicRoot, toolchain.NODE_IMAGE, toolchain.PNPM_VERSION);
    runChecked("docker", ["network", "create", "--internal", "--label", label, network], "Could not create the isolated verifier network.");
    runChecked("docker", ["run", "--detach", "--name", postgres, "--label", label, "--network", network, "--network-alias", "postgres", "--env", "POSTGRES_DB=change_two", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_USER=change_two", toolchain.POSTGRES_IMAGE], "Could not start verifier PostgreSQL.");
    waitForPostgres(postgres);
    runChecked("docker", ["run", "--detach", "--name", application, "--label", label, "--network", network, "--network-alias", "submission", "--mount", `type=bind,src=${workspace},dst=/submission,readonly`, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", image, "node", "/trusted/packages/runner/src/verification-app.mjs"], "Could not start the submitted application runtime.");
    waitForApplication(application);
    runChecked("docker", ["create", "--name", checker, "--label", label, "--network", network, "--mount", `type=bind,src=${checkBundle},dst=/check-bundle,readonly`, "--workdir", "/check-bundle", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", image, "node", "/trusted/packages/runner/src/verification-checker.mjs", "/verification-report.json"], "Could not create the trusted Check runtime.");
    const checkerResult = run("docker", ["start", "--attach", checker]);
    const copiedReport = join(temporary, "report.json");
    runChecked("docker", ["cp", `${checker}:/verification-report.json`, copiedReport], "Trusted Check runtime did not emit a report.");
    report = parseReport(copiedReport, manifest);
    if (checkerResult.status === 2 && report.error === null) throw new Error("Trusted Check runtime failed without an operational error report.");
    if (checkerResult.status !== 0 && checkerResult.status !== 1 && checkerResult.status !== 2) throw new Error(`Trusted Check runtime exited unexpectedly (${checkerResult.status ?? "unknown"}): ${checkerResult.stderr.trim()}`);
  } catch (error) {
    const category = error instanceof VerificationOperationalError
      ? error.category
      : "setup";
    report = operationalReport(manifest.checks.map((check) => check.checkId), category, diagnostic(error));
  } finally {
    removeContainer(checker);
    removeContainer(application);
    removeContainer(postgres);
    run("docker", ["network", "rm", network]);
    rmSync(temporary, { force: true, recursive: true });
  }
  if (directoryDigest(workspace) !== initialDigest) report = operationalReport(manifest.checks.map((check) => check.checkId), "integrity", "Submitted workspace changed during verification.");
  writeReport(output, report);
  return report;
}

export function cleanupVerificationSession(outputPath: string): void {
  const label = `change-two.verification=${verificationSession(resolve(outputPath))}`;
  const containers = run("docker", ["ps", "--all", "--quiet", "--filter", `label=${label}`]).stdout
    .split("\n")
    .filter(Boolean);
  for (const container of containers) removeContainer(container);
  const networks = run("docker", ["network", "ls", "--quiet", "--filter", `label=${label}`]).stdout
    .split("\n")
    .filter(Boolean);
  for (const network of networks) run("docker", ["network", "rm", network]);
}

function verifierImage(publicRoot: string, nodeImage: string, pnpmVersion: string): string {
  const inputs = ["docker/verifier.Dockerfile", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "packages/runner/package.json", "packages/runner/src/verification-app.mjs", "packages/runner/src/verification-checker.mjs"];
  const digest = createHash("sha256"); for (const path of inputs) digest.update(readFileSync(join(publicRoot, path)));
  const image = `change-two-verifier:${digest.digest("hex").slice(0, 16)}`;
  runChecked("docker", ["build", "--file", join(publicRoot, "docker/verifier.Dockerfile"), "--tag", image, "--build-arg", `NODE_IMAGE=${nodeImage}`, "--build-arg", `PNPM_VERSION=${pnpmVersion}`, publicRoot], "Could not build the pinned trusted verifier runtime.");
  return image;
}
function waitForPostgres(container: string): void {
  for (let attempt = 0; attempt < 60; attempt += 1) { if (run("docker", ["exec", container, "pg_isready", "-U", "change_two", "-d", "change_two"]).status === 0) return; if (!containerRunning(container)) throw new Error(`Verifier PostgreSQL exited before readiness: ${containerLogs(container)}`); sleep(500); }
  throw new Error(`Verifier PostgreSQL did not become ready: ${containerLogs(container)}`);
}
function waitForApplication(container: string): void {
  const probe = "Promise.all([fetch('http://127.0.0.1:3000/health'),fetch('http://127.0.0.1:4173')]).then(r=>{if(r.some(x=>!x.ok))process.exit(1)}).catch(()=>process.exit(1))";
  for (let attempt = 0; attempt < 600; attempt += 1) { if (run("docker", ["exec", container, "node", "-e", probe]).status === 0) return; if (!containerRunning(container)) throw new VerificationOperationalError("application", `Submitted application setup failed: ${containerLogs(container)}`); sleep(500); }
  throw new VerificationOperationalError("application", `Submitted application did not become ready: ${containerLogs(container)}`);
}
function containerRunning(container: string): boolean { return run("docker", ["inspect", "--format", "{{.State.Running}}", container]).stdout.trim() === "true"; }
function containerLogs(container: string): string { const result = run("docker", ["logs", "--tail", "100", container]); return `${result.stdout}\n${result.stderr}`.trim(); }
function removeContainer(container: string): void { run("docker", ["rm", "--force", container]); }
function readManifest(directory: string): BundleManifest {
  const value = JSON.parse(readFileSync(join(directory, "bundle.json"), "utf8")) as Partial<BundleManifest>;
  if (value.schemaVersion !== "verification-bundle/v1" || typeof value.entrypoint !== "string" || value.entrypoint.length === 0 || !Array.isArray(value.checks) || value.checks.length === 0) throw new Error("Invalid verification-bundle/v1 manifest.");
  const identifiers = new Set<string>(); for (const check of value.checks) { if (typeof check?.checkId !== "string" || check.checkId.length === 0 || typeof check.title !== "string" || check.title.length === 0 || identifiers.has(check.checkId)) throw new Error("Check bundle has a missing or duplicate Check declaration."); identifiers.add(check.checkId); }
  return value as BundleManifest;
}
function parseReport(path: string, manifest: BundleManifest): VerificationReport {
  const value = JSON.parse(readFileSync(path, "utf8")) as VerificationReport;
  if (value.schemaVersion !== "verification-report/v1" || typeof value.passed !== "boolean" || !Array.isArray(value.checks)) throw new Error("Trusted runtime emitted an invalid verification report.");
  const expected = manifest.checks.map((check) => check.checkId); if (value.checks.length !== expected.length || value.checks.some((check, index) => check.checkId !== expected[index])) throw new Error("Trusted runtime report Check order does not match its bundle."); return value;
}
function operationalReport(checkIds: readonly string[], category: "integrity" | "setup" | "bundle" | "application", message: string): VerificationReport { return { schemaVersion: "verification-report/v1", passed: false, error: { category, diagnostic: message }, checks: checkIds.map((checkId) => ({ checkId, status: "error", diagnostics: [message], evidence: [] })) }; }
function directoryDigest(root: string): string {
  const digest = createHash("sha256"); const visit = (directory: string): void => { for (const name of readdirSync(directory).sort()) { const path = join(directory, name); const label = relative(root, path).split(sep).join("/"); const metadata = lstatSync(path); if (metadata.isDirectory()) { digest.update(`directory\0${label}\0`); visit(path); } else if (metadata.isSymbolicLink()) digest.update(`symlink\0${label}\0${readlinkSync(path)}\0`); else if (metadata.isFile()) { digest.update(`file\0${label}\0${metadata.size}\0`); digest.update(readFileSync(path)); } else digest.update(`other\0${label}\0${metadata.mode}\0`); } }; visit(root); return digest.digest("hex");
}
function readToolchain(publicRoot: string): Record<"NODE_IMAGE" | "PNPM_VERSION" | "POSTGRES_IMAGE", string> {
  const entries = new Map<string, string>(); for (const line of readFileSync(join(publicRoot, "toolchain.env"), "utf8").split("\n")) { const separator = line.indexOf("="); if (separator > 0) entries.set(line.slice(0, separator), line.slice(separator + 1)); }
  const NODE_IMAGE = entries.get("NODE_IMAGE"); const PNPM_VERSION = entries.get("PNPM_VERSION"); const POSTGRES_IMAGE = entries.get("POSTGRES_IMAGE"); if (NODE_IMAGE === undefined || PNPM_VERSION !== "11.22.0" || POSTGRES_IMAGE === undefined) throw new Error("Pinned verifier toolchain is incomplete."); return { NODE_IMAGE, PNPM_VERSION, POSTGRES_IMAGE };
}
function verificationSession(outputPath: string): string {
  return createHash("sha256").update(outputPath).digest("hex");
}
function requireDirectory(path: string, label: string): string { const absolute = resolve(path); if (!existsSync(absolute) || !statSync(absolute).isDirectory()) throw new RunnerError("input", `${label} is not a directory: ${absolute}`); return absolute; }
function runChecked(command: string, arguments_: readonly string[], message: string): ProcessResult { const result = run(command, arguments_); if (result.status !== 0) throw new Error(`${message} ${result.stderr.trim()}`.trim()); return result; }
function run(command: string, arguments_: readonly string[]): ProcessResult { const result = spawnSync(command, arguments_, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }; }
function sleep(milliseconds: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); }
function diagnostic(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function writeReport(output: string, report: VerificationReport): void { const temporary = `${output}.tmp-${process.pid}`; writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" }); renameSync(temporary, output); }
