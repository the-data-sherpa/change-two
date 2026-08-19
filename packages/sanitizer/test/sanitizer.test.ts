import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { materializeCapture, verifyBundle } from "@change-two/evidence";
import {
  approvePublication,
  assertPublicationReady,
  readSanitizationPolicy,
  recordRetention,
  sanitizeBundle,
  scanBundle,
  SanitizationError,
} from "../src/index.js";
import type { ApprovalRequest, RetentionRequest, SanitizationPolicy } from "../src/types.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const acceptedFixture = join(repositoryRoot, "fixtures/evidence/accepted");
const packageFixtures = join(repositoryRoot, "packages/sanitizer/fixtures");
const policy = readSanitizationPolicy(join(packageFixtures, "policy.json"));
const cases = JSON.parse(readFileSync(join(packageFixtures, "synthetic-cases.json"), "utf8")) as {
  redactable: Record<string, string>;
  blockers: Record<string, string>;
  ambiguous: string;
  clean: string;
};
const sanitizeRequest = { reportId: "report:test", generatedAt: "2026-01-02T00:00:00.000Z" };
const approvalRequest = JSON.parse(readFileSync(join(packageFixtures, "approval-request.json"), "utf8")) as ApprovalRequest;

function createBundle(root: string, injectedText: string): string {
  const captureDirectory = join(root, "capture");
  cpSync(acceptedFixture, captureDirectory, { recursive: true });
  const capturePath = join(captureDirectory, "capture.jsonl");
  const events = readFileSync(capturePath, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  const message = events.find((event) => event.eventId === "event:message") as { payload: { text: string } };
  message.payload.text = injectedText;
  writeFileSync(capturePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  const bundle = join(root, "quarantine-bundle");
  materializeCapture(capturePath, bundle);
  return bundle;
}

function temporary(): string { return mkdtempSync(join(tmpdir(), "change-two-sanitizer-")); }
function approve(publication: string): void { approvePublication(publication, approvalRequest); }

test("scan quarantines blockers, unreleased content, and ambiguity", () => {
  for (const seeded of [...Object.values(cases.blockers), cases.ambiguous]) {
    const root = temporary();
    try {
      const bundle = createBundle(root, seeded);
      const scan = scanBundle(bundle, policy, { generatedAt: sanitizeRequest.generatedAt });
      assert.equal(scan.status, "quarantined");
      assert.ok(scan.findings.some((finding) => finding.disposition !== "redact"));
      assert.throws(() => sanitizeBundle(bundle, join(root, "publication"), policy, sanitizeRequest), SanitizationError);
      assert.equal(existsSync(join(root, "publication")), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }

  const root = temporary();
  try {
    const bundle = createBundle(root, cases.clean);
    const unreleasedPolicy: SanitizationPolicy = { ...policy, releasedHiddenCheckIds: [] };
    const scan = scanBundle(bundle, unreleasedPolicy, { generatedAt: sanitizeRequest.generatedAt });
    assert.ok(scan.findings.some((finding) => finding.rule === "unreleased-hidden-check-id"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sanitization redacts deterministically, records checksum links, and never mutates source", () => {
  const root = temporary();
  try {
    const injected = Object.values(cases.redactable).join("\n");
    const source = createBundle(root, injected);
    const sourceIdentity = verifyBundle(source);
    const sourceTrajectory = readFileSync(join(source, "trajectory.jsonl"));
    const first = join(root, "publication-first");
    const second = join(root, "publication-second");
    const firstReport = sanitizeBundle(source, first, policy, sanitizeRequest);
    const secondReport = sanitizeBundle(source, second, policy, sanitizeRequest);
    assert.equal(firstReport.sanitizedBundle.contentSetSha256, secondReport.sanitizedBundle.contentSetSha256);
    assert.deepEqual(firstReport.transformations, secondReport.transformations);
    assert.ok(firstReport.findings.some((finding) => finding.category === "credential"));
    assert.ok(firstReport.findings.some((finding) => finding.category === "authentication"));
    assert.ok(firstReport.findings.some((finding) => finding.category === "private-path"));
    assert.ok(firstReport.transformations.every((record) => record.sourceSha256.length === 64 && record.sanitizedSha256.length === 64));
    assert.equal(verifyBundle(source).contentSetSha256, sourceIdentity.contentSetSha256);
    assert.deepEqual(readFileSync(join(source, "trajectory.jsonl")), sourceTrajectory);
    const publicTrajectory = readFileSync(join(first, "bundle/trajectory.jsonl"), "utf8");
    assert.doesNotMatch(publicTrajectory, /synthetic-user|ct_test_|fake\.header/);
    assert.match(publicTrajectory, /\[REDACTED:/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("publication requires a separate human approval with explicit evidence class", () => {
  const root = temporary();
  try {
    const source = createBundle(root, cases.clean);
    const publication = join(root, "publication");
    sanitizeBundle(source, publication, policy, sanitizeRequest);
    assert.throws(() => assertPublicationReady(publication, { now: "2026-01-03T00:00:00.000Z" }), SanitizationError);
    assert.throws(() => approvePublication(publication, { ...approvalRequest, approver: { kind: "automation", identifier: "forbidden" } } as never), SanitizationError);
    const approval = approvePublication(publication, approvalRequest);
    assert.equal(approval.evidenceClass, "practice");
    assert.equal(assertPublicationReady(publication, { now: "2026-01-03T00:00:00.000Z" }).approval.approvalId, approval.approvalId);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("retention enforces destruction and preserves incident hold history", () => {
  const root = temporary();
  try {
    const source = createBundle(root, cases.clean);
    const publication = join(root, "publication");
    sanitizeBundle(source, publication, policy, sanitizeRequest); approve(publication);
    const hold: RetentionRequest = { eventId: "hold:1", action: "hold", recordedAt: "2026-01-20T00:00:00.000Z", actor: { kind: "human", identifier: "incident-reviewer" }, reason: "Synthetic incident review", incidentReference: "incident:synthetic-1" };
    recordRetention(publication, source, hold);
    assert.doesNotThrow(() => assertPublicationReady(publication, { now: "2026-02-10T00:00:00.000Z" }));
    assert.throws(() => recordRetention(publication, source, { eventId: "destroy:blocked", action: "destroy", recordedAt: "2026-02-10T00:00:00.000Z", actor: { kind: "automation", identifier: "retention-job" }, reason: "Deadline" }), SanitizationError);
    recordRetention(publication, source, { eventId: "release:1", action: "release-hold", recordedAt: "2026-02-11T00:00:00.000Z", actor: { kind: "human", identifier: "incident-reviewer" }, reason: "Review complete" });
    const record = recordRetention(publication, source, { eventId: "destroy:1", action: "destroy", recordedAt: "2026-02-11T00:00:01.000Z", actor: { kind: "automation", identifier: "retention-job" }, reason: "30-day retention complete" });
    assert.equal(existsSync(source), false);
    assert.deepEqual(record.events.map((event) => event.eventType), ["scheduled", "hold-placed", "hold-released", "destroyed"]);
    assert.doesNotThrow(() => assertPublicationReady(publication, { now: "2026-02-12T00:00:00.000Z" }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("repository CLI scan emits a quarantined report and nonzero status", () => {
  const root = temporary();
  try {
    const bundle = createBundle(root, cases.ambiguous);
    const output = join(root, "scan.json");
    const result = spawnSync(process.execPath, ["--import", join(repositoryRoot, "packages/sanitizer/node_modules/tsx/dist/loader.mjs"), join(repositoryRoot, "packages/sanitizer/src/cli.ts"), "scan", bundle, join(packageFixtures, "policy.json"), output], { cwd: repositoryRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^QUARANTINED /);
    assert.equal((JSON.parse(readFileSync(output, "utf8")) as { status: string }).status, "quarantined");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
