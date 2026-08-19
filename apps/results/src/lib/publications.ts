import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import {
  EvidenceError,
  verifyBundle,
  type ArtifactReference,
  type BundleRevision,
  type CaptureEvent,
  type ChecksumManifest,
  type MaterializeResult,
} from "@change-two/evidence";

const ENVELOPE_ENTRIES = [
  "bundle",
  "publication-approval.json",
  "retention-record.json",
  "sanitization-report.json",
] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

export class PublicationError extends Error {
  readonly target: string;

  constructor(target: string, message: string) {
    super(`Publication validation failed for ${target}: ${message}`);
    this.name = "PublicationError";
    this.target = target;
  }
}

interface VersionedTool {
  readonly name: string;
  readonly version: string | null;
}

export interface ManifestDocument {
  readonly agent: VersionedTool;
  readonly budgetId: string;
  readonly bundleRevisionId: string;
  readonly changeId: string;
  readonly endedAt: string;
  readonly endingCommit: string;
  readonly harness: VersionedTool;
  readonly lineageId: string;
  readonly model: VersionedTool;
  readonly policyId: string;
  readonly runId: string;
  readonly seasonId: string;
  readonly startedAt: string;
  readonly startingCommit: string;
  readonly status: "accepted" | "invalid" | "stopped" | "error";
}

export interface EnvironmentDocument {
  readonly dependencies: readonly VersionedTool[];
  readonly platform: string;
  readonly runtimeImage: string;
  readonly source: string;
}

export interface InterventionDocument {
  readonly category: string;
  readonly eventId: string;
  readonly humanActiveSeconds: number;
  readonly interventionId: string;
  readonly policyJustification: string | null;
  readonly source: string;
  readonly text: string;
  readonly timestamp: string;
}

interface MeasurementSource {
  readonly kind: string;
  readonly name: string;
  readonly providerEventId: string | null;
}

export interface UsageMeasurement {
  readonly inputTokens: number | null;
  readonly measurement: string;
  readonly outputTokens: number | null;
  readonly source: MeasurementSource;
  readonly totalTokens: number | null;
}

export interface ModelCostMeasurement {
  readonly amount: number | null;
  readonly currency: string | null;
  readonly measurement: string;
  readonly source: MeasurementSource;
}

export interface CostsDocument {
  readonly coverageGaps: readonly string[];
  readonly humanActiveSecondsByRole: Readonly<Record<string, number>>;
  readonly modelCosts: readonly ModelCostMeasurement[];
  readonly usage: readonly UsageMeasurement[];
  readonly wallClockSeconds: number;
}

export interface CheckResult {
  readonly checkId: string;
  readonly covers: readonly string[];
  readonly existedBeforeExecution: boolean;
  readonly outcome: "pass" | "fail" | "skipped" | "error";
  readonly reproductionArtifact: ArtifactReference | null;
  readonly severity: string;
  readonly sourceEventIds: readonly string[];
}

export interface FindingDocument {
  readonly artifactReferences: readonly ArtifactReference[];
  readonly findingId: string;
  readonly severity: string;
  readonly sourceEventIds: readonly string[];
  readonly statement: string;
  readonly status: string;
}

export interface SummaryResult {
  readonly evidenceLinks: readonly string[];
  readonly resultId: string;
  readonly statement: string;
}

export interface SummaryDocument {
  readonly limitations: readonly string[];
  readonly results: readonly SummaryResult[];
  readonly status: ManifestDocument["status"];
}

export interface RepositoryStateDocument {
  readonly patchPath: "submitted.patch";
  readonly source: string;
  readonly startingCommit: string;
  readonly submittedCommit: string;
  readonly workingTreeDirty: boolean;
}

export interface SanitizationTransformation {
  readonly reason: string;
  readonly rule: string;
  readonly sanitizedPath: string;
  readonly sanitizedSha256: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
}

export interface SanitizationReport {
  readonly ambiguities: readonly unknown[];
  readonly blockers: readonly unknown[];
  readonly findings: readonly unknown[];
  readonly generatedAt: string;
  readonly policy: { readonly releaseId: string; readonly sha256: string };
  readonly reportId: string;
  readonly sanitizedBundle: { readonly contentSetSha256: string; readonly revisionId: string };
  readonly sourceBundle: { readonly contentSetSha256: string; readonly revisionId: string };
  readonly status: "passed";
  readonly transformations: readonly SanitizationTransformation[];
}

export interface PublicationApproval {
  readonly approvalId: string;
  readonly approvedAt: string;
  readonly approver: { readonly identifier: string; readonly kind: "human" };
  readonly decision: "approved";
  readonly evidenceClass: "practice" | "measured";
  readonly immutableReleaseAssetUrl: string | null;
  readonly reportId: string;
  readonly sanitizedContentSetSha256: string;
  readonly statement: string;
}

export interface RetentionEvent {
  readonly actor: { readonly identifier: string; readonly kind: "human" | "automation" };
  readonly eventId: string;
  readonly eventType: "scheduled" | "hold-placed" | "hold-released" | "destroyed";
  readonly incidentReference: string | null;
  readonly reason: string;
  readonly recordedAt: string;
}

export interface RetentionRecord {
  readonly destructionDueAt: string;
  readonly events: readonly RetentionEvent[];
  readonly publicationApprovedAt: string;
  readonly sourceContentSetSha256: string;
}

export interface NormalizedRun {
  readonly checksums: ChecksumManifest;
  readonly costs: CostsDocument;
  readonly environment: EnvironmentDocument;
  readonly hiddenResults: readonly CheckResult[];
  readonly interventions: readonly InterventionDocument[];
  readonly manifest: ManifestDocument;
  readonly patch: string;
  readonly repositoryState: RepositoryStateDocument;
  readonly requirement: string;
  readonly reviewerFindings: readonly FindingDocument[];
  readonly revision: BundleRevision | null;
  readonly summary: SummaryDocument;
  readonly trajectory: readonly CaptureEvent[];
  readonly visibleResults: readonly CheckResult[];
}

export interface Publication {
  readonly approval: PublicationApproval;
  readonly bundleDirectory: string;
  readonly directory: string;
  readonly rawFiles: readonly { readonly mediaType: string; readonly path: string }[];
  readonly report: SanitizationReport;
  readonly retention: RetentionRecord;
  readonly revisionSlug: string;
  readonly run: NormalizedRun;
  readonly verification: MaterializeResult;
}

export function loadPublications(
  input = process.env.RESULTS_PUBLICATIONS_DIR ?? resolve(process.cwd(), "fixtures/publications/approved-practice"),
  now = new Date(),
): readonly Publication[] {
  const absoluteInput = resolve(input);
  const entries = readDirectory(absoluteInput, "publication input");
  const looksLikeEnvelope = entries.some((entry) =>
    (ENVELOPE_ENTRIES as readonly string[]).includes(entry)
  );
  const directories = looksLikeEnvelope
    ? [absoluteInput]
    : entries.map((entry) => {
        const candidate = join(absoluteInput, entry);
        if (!lstatSync(candidate).isDirectory()) {
          throw new PublicationError(candidate, "publication input may contain only envelope directories");
        }
        return candidate;
      });
  if (directories.length === 0) {
    throw new PublicationError(absoluteInput, "contains no publication envelopes");
  }
  const publications = directories.map((directory) => loadPublication(directory, now));
  const routes = new Set<string>();
  for (const publication of publications) {
    if (routes.has(publication.revisionSlug)) {
      throw new PublicationError(publication.directory, `duplicate revision route '${publication.revisionSlug}'`);
    }
    routes.add(publication.revisionSlug);
  }
  return publications.toSorted((left, right) => left.approval.approvedAt.localeCompare(right.approval.approvedAt));
}

export function latestByRun(publications: readonly Publication[]): readonly Publication[] {
  const latest = new Map<string, Publication>();
  for (const publication of publications) {
    const current = latest.get(publication.run.manifest.runId);
    if (current === undefined || current.approval.approvedAt < publication.approval.approvedAt) {
      latest.set(publication.run.manifest.runId, publication);
    }
  }
  return [...latest.values()].toSorted((left, right) => left.run.manifest.startedAt.localeCompare(right.run.manifest.startedAt));
}

export function routeSegment(identifier: string): string {
  const segment = identifier.replaceAll(":", "-").replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "");
  if (segment.length === 0) throw new PublicationError(identifier, "cannot form a route segment");
  return segment;
}

export function runHref(publication: Publication): string {
  return `/runs/${routeSegment(publication.run.manifest.runId)}/`;
}

export function rawBundleHref(publication: Publication, path: string): string {
  return `/bundles/${publication.revisionSlug}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function anchorId(kind: string, identifier: string): string {
  return `${kind}-${routeSegment(identifier)}`;
}

export function evidenceHref(publication: Publication, link: string): string {
  const separator = link.indexOf(":");
  const kind = link.slice(0, separator);
  const identifier = link.slice(separator + 1);
  if (kind === "event") return `${runHref(publication)}#${anchorId("event", link)}`;
  if (kind === "visible-result") return `${runHref(publication)}#${anchorId("visible", identifier)}`;
  if (kind === "hidden-result") return `${runHref(publication)}#${anchorId("hidden", identifier)}`;
  if (kind === "reviewer-finding") return `${runHref(publication)}#${anchorId("finding", `finding:${identifier}`)}`;
  if (kind === "artifact") {
    const artifact = collectArtifacts(publication.run).find((candidate) => candidate.artifactId === link);
    if (artifact !== undefined) return rawBundleHref(publication, artifact.path);
  }
  throw new PublicationError(publication.directory, `cannot render dangling evidence link '${link}'`);
}

function loadPublication(directory: string, now: Date): Publication {
  assertExactEntries(directory, ENVELOPE_ENTRIES);
  const bundleDirectory = join(directory, "bundle");
  let verification: MaterializeResult;
  try {
    verification = verifyBundle(bundleDirectory);
  } catch (error) {
    if (error instanceof EvidenceError) {
      throw new PublicationError(directory, error.issues.map((issue) => `${issue.path} [${issue.keyword}] ${issue.message}`).join("; "));
    }
    throw error;
  }
  const report = parseReport(readJson(join(directory, "sanitization-report.json")));
  const approval = parseApproval(readJson(join(directory, "publication-approval.json")));
  const retention = parseRetention(readJson(join(directory, "retention-record.json")));
  validateEnvelopeLinks(directory, verification, report, approval, retention, bundleDirectory, now);
  const run: NormalizedRun = {
    checksums: readJson(join(bundleDirectory, "checksums.json")) as ChecksumManifest,
    costs: readJson(join(bundleDirectory, "costs.json")) as CostsDocument,
    environment: readJson(join(bundleDirectory, "environment.json")) as EnvironmentDocument,
    hiddenResults: (readJson(join(bundleDirectory, "hidden-results.json")) as { readonly results: readonly CheckResult[] }).results,
    interventions: readJsonLines(join(bundleDirectory, "interventions.jsonl")) as readonly InterventionDocument[],
    manifest: readJson(join(bundleDirectory, "manifest.json")) as ManifestDocument,
    patch: readFileSync(join(bundleDirectory, "submitted.patch"), "utf8"),
    repositoryState: readJson(join(bundleDirectory, "repository-state.json")) as RepositoryStateDocument,
    requirement: readFileSync(join(bundleDirectory, "requirement.md"), "utf8"),
    reviewerFindings: (readJson(join(bundleDirectory, "reviewer-findings.json")) as { readonly findings: readonly FindingDocument[] }).findings,
    revision: existsSync(join(bundleDirectory, "revision.json")) ? readJson(join(bundleDirectory, "revision.json")) as BundleRevision : null,
    summary: readJson(join(bundleDirectory, "summary.json")) as SummaryDocument,
    trajectory: readJsonLines(join(bundleDirectory, "trajectory.jsonl")) as readonly CaptureEvent[],
    visibleResults: (readJson(join(bundleDirectory, "visible-results.json")) as { readonly results: readonly CheckResult[] }).results,
  };
  return {
    approval, bundleDirectory, directory, rawFiles: listBundleFiles(bundleDirectory), report, retention,
    revisionSlug: routeSegment(verification.revisionId), run, verification,
  };
}

function parseReport(value: unknown): SanitizationReport {
  const target = "sanitization-report.json";
  const record = assertRecord(value, target);
  assertKeys(record, ["ambiguities", "blockers", "findings", "generatedAt", "policy", "reportId", "sanitizedBundle", "schemaType", "schemaVersion", "sourceBundle", "status", "transformations"], [], target);
  assertLiteral(record.schemaType, "sanitization-report", `${target}/schemaType`);
  assertLiteral(record.schemaVersion, "sanitization/v1", `${target}/schemaVersion`);
  assertLiteral(record.status, "passed", `${target}/status`);
  const policy = assertRecord(record.policy, `${target}/policy`);
  assertKeys(policy, ["releaseId", "sha256"], [], `${target}/policy`);
  const transformations = assertArray(record.transformations, `${target}/transformations`).map((item, index) => {
    const itemTarget = `${target}/transformations/${index}`;
    const transformation = assertRecord(item, itemTarget);
    assertKeys(transformation, ["reason", "rule", "sanitizedPath", "sanitizedSha256", "sourcePath", "sourceSha256"], [], itemTarget);
    return {
      reason: assertString(transformation.reason, `${itemTarget}/reason`),
      rule: assertString(transformation.rule, `${itemTarget}/rule`),
      sanitizedPath: assertRelativePath(transformation.sanitizedPath, `${itemTarget}/sanitizedPath`),
      sanitizedSha256: assertSha256(transformation.sanitizedSha256, `${itemTarget}/sanitizedSha256`),
      sourcePath: assertRelativePath(transformation.sourcePath, `${itemTarget}/sourcePath`),
      sourceSha256: assertSha256(transformation.sourceSha256, `${itemTarget}/sourceSha256`),
    };
  });
  return {
    ambiguities: assertArray(record.ambiguities, `${target}/ambiguities`),
    blockers: assertArray(record.blockers, `${target}/blockers`),
    findings: assertArray(record.findings, `${target}/findings`),
    generatedAt: assertDate(record.generatedAt, `${target}/generatedAt`),
    policy: { releaseId: assertString(policy.releaseId, `${target}/policy/releaseId`), sha256: assertSha256(policy.sha256, `${target}/policy/sha256`) },
    reportId: assertString(record.reportId, `${target}/reportId`),
    sanitizedBundle: parseBundleIdentity(record.sanitizedBundle, `${target}/sanitizedBundle`),
    sourceBundle: parseBundleIdentity(record.sourceBundle, `${target}/sourceBundle`),
    status: "passed",
    transformations,
  };
}

function parseApproval(value: unknown): PublicationApproval {
  const target = "publication-approval.json";
  const record = assertRecord(value, target);
  assertKeys(record, ["approvalId", "approvedAt", "approver", "decision", "evidenceClass", "reportId", "sanitizedContentSetSha256", "schemaType", "schemaVersion", "statement"], ["immutableReleaseAssetUrl"], target);
  assertLiteral(record.schemaType, "publication-approval", `${target}/schemaType`);
  assertLiteral(record.schemaVersion, "sanitization/v1", `${target}/schemaVersion`);
  assertLiteral(record.decision, "approved", `${target}/decision`);
  if (record.evidenceClass !== "practice" && record.evidenceClass !== "measured") throw new PublicationError(`${target}/evidenceClass`, "must be practice or measured");
  const approver = assertRecord(record.approver, `${target}/approver`);
  assertKeys(approver, ["identifier", "kind"], [], `${target}/approver`);
  assertLiteral(approver.kind, "human", `${target}/approver/kind`);
  let immutableReleaseAssetUrl: string | null = null;
  if (record.immutableReleaseAssetUrl !== undefined && record.immutableReleaseAssetUrl !== null) {
    immutableReleaseAssetUrl = assertString(record.immutableReleaseAssetUrl, `${target}/immutableReleaseAssetUrl`);
    let url: URL;
    try { url = new URL(immutableReleaseAssetUrl); } catch { throw new PublicationError(`${target}/immutableReleaseAssetUrl`, "must be an HTTPS URL"); }
    if (url.protocol !== "https:") throw new PublicationError(`${target}/immutableReleaseAssetUrl`, "must use HTTPS");
  }
  return {
    approvalId: assertString(record.approvalId, `${target}/approvalId`),
    approvedAt: assertDate(record.approvedAt, `${target}/approvedAt`),
    approver: { identifier: assertString(approver.identifier, `${target}/approver/identifier`), kind: "human" },
    decision: "approved",
    evidenceClass: record.evidenceClass,
    immutableReleaseAssetUrl,
    reportId: assertString(record.reportId, `${target}/reportId`),
    sanitizedContentSetSha256: assertSha256(record.sanitizedContentSetSha256, `${target}/sanitizedContentSetSha256`),
    statement: assertString(record.statement, `${target}/statement`),
  };
}

function parseRetention(value: unknown): RetentionRecord {
  const target = "retention-record.json";
  const record = assertRecord(value, target);
  assertKeys(record, ["destructionDueAt", "events", "publicationApprovedAt", "schemaType", "schemaVersion", "sourceContentSetSha256"], [], target);
  assertLiteral(record.schemaType, "retention-record", `${target}/schemaType`);
  assertLiteral(record.schemaVersion, "sanitization/v1", `${target}/schemaVersion`);
  const events = assertArray(record.events, `${target}/events`).map((item, index): RetentionEvent => {
    const itemTarget = `${target}/events/${index}`;
    const event = assertRecord(item, itemTarget);
    assertKeys(event, ["actor", "eventId", "eventType", "reason", "recordedAt"], ["incidentReference"], itemTarget);
    if (event.eventType !== "scheduled" && event.eventType !== "hold-placed" && event.eventType !== "hold-released" && event.eventType !== "destroyed") throw new PublicationError(`${itemTarget}/eventType`, "is invalid");
    const actor = assertRecord(event.actor, `${itemTarget}/actor`);
    assertKeys(actor, ["identifier", "kind"], [], `${itemTarget}/actor`);
    if (actor.kind !== "human" && actor.kind !== "automation") throw new PublicationError(`${itemTarget}/actor/kind`, "is invalid");
    const incidentReference = event.incidentReference === undefined || event.incidentReference === null ? null : assertString(event.incidentReference, `${itemTarget}/incidentReference`);
    if (event.eventType === "hold-placed" && incidentReference === null) throw new PublicationError(itemTarget, "hold-placed requires incidentReference");
    return {
      actor: { identifier: assertString(actor.identifier, `${itemTarget}/actor/identifier`), kind: actor.kind },
      eventId: assertString(event.eventId, `${itemTarget}/eventId`), eventType: event.eventType,
      incidentReference, reason: assertString(event.reason, `${itemTarget}/reason`), recordedAt: assertDate(event.recordedAt, `${itemTarget}/recordedAt`),
    };
  });
  return {
    destructionDueAt: assertDate(record.destructionDueAt, `${target}/destructionDueAt`), events,
    publicationApprovedAt: assertDate(record.publicationApprovedAt, `${target}/publicationApprovedAt`),
    sourceContentSetSha256: assertSha256(record.sourceContentSetSha256, `${target}/sourceContentSetSha256`),
  };
}

function validateEnvelopeLinks(directory: string, verification: MaterializeResult, report: SanitizationReport, approval: PublicationApproval, retention: RetentionRecord, bundleDirectory: string, now: Date): void {
  if (report.blockers.length > 0 || report.ambiguities.length > 0) throw new PublicationError(directory, "sanitization report is quarantined");
  if (report.sanitizedBundle.revisionId !== verification.revisionId || report.sanitizedBundle.contentSetSha256 !== verification.contentSetSha256) throw new PublicationError(directory, "report does not identify the verified bundle");
  if (approval.reportId !== report.reportId || approval.sanitizedContentSetSha256 !== verification.contentSetSha256) throw new PublicationError(directory, "approval does not identify the report and verified bundle");
  if (retention.sourceContentSetSha256 !== report.sourceBundle.contentSetSha256 || retention.publicationApprovedAt !== approval.approvedAt) throw new PublicationError(directory, "retention record is not linked to source and approval");
  if (Date.parse(retention.destructionDueAt) - Date.parse(retention.publicationApprovedAt) !== RETENTION_MILLISECONDS) throw new PublicationError(directory, "destruction deadline must be exactly 30 days after approval");
  const checksums = readJson(join(bundleDirectory, "checksums.json")) as ChecksumManifest;
  const checksumByPath = new Map(checksums.entries.map((entry) => [entry.path, entry.sha256]));
  for (const transformation of report.transformations) if (checksumByPath.get(transformation.sanitizedPath) !== transformation.sanitizedSha256) throw new PublicationError(directory, `transformation checksum does not match '${transformation.sanitizedPath}'`);
  validateRetentionEvents(directory, retention, now);
}

function validateRetentionEvents(directory: string, retention: RetentionRecord, now: Date): void {
  let activeHold = false;
  let destroyed = false;
  let scheduled = 0;
  let previousTime = Number.NEGATIVE_INFINITY;
  const eventIds = new Set<string>();
  for (const event of retention.events) {
    const eventTime = Date.parse(event.recordedAt);
    if (eventTime < previousTime || eventTime < Date.parse(retention.publicationApprovedAt)) throw new PublicationError(directory, "retention events are not chronological");
    previousTime = eventTime;
    if (eventIds.has(event.eventId)) throw new PublicationError(directory, `duplicate retention event '${event.eventId}'`);
    eventIds.add(event.eventId);
    if (destroyed) throw new PublicationError(directory, "destroyed event must be terminal");
    if (event.eventType === "scheduled") scheduled += 1;
    if (event.eventType === "hold-placed") {
      if (activeHold) throw new PublicationError(directory, "second active hold is invalid");
      activeHold = true;
    }
    if (event.eventType === "hold-released") {
      if (!activeHold) throw new PublicationError(directory, "hold release has no active hold");
      activeHold = false;
    }
    if (event.eventType === "destroyed") { activeHold = false; destroyed = true; }
  }
  if (scheduled !== 1) throw new PublicationError(directory, "exactly one scheduled event is required");
  if (!destroyed && !activeHold && now.getTime() > Date.parse(retention.destructionDueAt)) throw new PublicationError(directory, "retention expired without destruction or active hold");
}

function parseBundleIdentity(value: unknown, target: string): { readonly contentSetSha256: string; readonly revisionId: string } {
  const record = assertRecord(value, target);
  assertKeys(record, ["contentSetSha256", "revisionId"], [], target);
  return { contentSetSha256: assertSha256(record.contentSetSha256, `${target}/contentSetSha256`), revisionId: assertString(record.revisionId, `${target}/revisionId`) };
}

function collectArtifacts(run: NormalizedRun): readonly ArtifactReference[] {
  const artifacts: ArtifactReference[] = [];
  for (const event of run.trajectory) if (event.artifactReference !== undefined) artifacts.push(event.artifactReference);
  for (const result of [...run.visibleResults, ...run.hiddenResults]) if (result.reproductionArtifact !== null) artifacts.push(result.reproductionArtifact);
  for (const finding of run.reviewerFindings) artifacts.push(...finding.artifactReferences);
  return artifacts;
}

function listBundleFiles(root: string, directory = root): readonly { readonly mediaType: string; readonly path: string }[] {
  const files: { readonly mediaType: string; readonly path: string }[] = [];
  for (const name of readdirSync(directory).toSorted()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new PublicationError(path, "bundle symlinks are invalid");
    if (stat.isDirectory()) files.push(...listBundleFiles(root, path));
    else if (stat.isFile()) {
      const relativePath = relative(root, path).split(sep).join("/");
      files.push({ mediaType: mediaType(relativePath), path: relativePath });
    }
  }
  return files;
}

function mediaType(path: string): string {
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".jsonl")) return "application/x-ndjson; charset=utf-8";
  if (path.endsWith(".patch")) return "text/x-diff; charset=utf-8";
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function assertExactEntries(directory: string, expected: readonly string[]): void {
  const actual = readDirectory(directory, "publication envelope");
  const sortedExpected = [...expected].toSorted();
  if (actual.length !== sortedExpected.length || actual.some((entry, index) => entry !== sortedExpected[index])) throw new PublicationError(directory, `must contain exactly ${sortedExpected.join(", ")}`);
  for (const entry of actual) if (lstatSync(join(directory, entry)).isSymbolicLink()) throw new PublicationError(join(directory, entry), "envelope symlinks are invalid");
  if (!lstatSync(join(directory, "bundle")).isDirectory()) throw new PublicationError(join(directory, "bundle"), "must be a directory");
}

function readDirectory(path: string, description: string): string[] {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) throw new PublicationError(path, `${description} directory does not exist`);
  return readdirSync(path).toSorted();
}

function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")) as unknown; }
  catch (error) { throw new PublicationError(path, `is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function readJsonLines(path: string): readonly unknown[] {
  return readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0).map((line, index) => {
    try { return JSON.parse(line) as unknown; }
    catch { throw new PublicationError(`${path}:${index + 1}`, "is not valid JSON"); }
  });
}

function assertRecord(value: unknown, target: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PublicationError(target, "must be an object");
  return value as Record<string, unknown>;
}
function assertArray(value: unknown, target: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new PublicationError(target, "must be an array");
  return value;
}
function assertKeys(record: Readonly<Record<string, unknown>>, required: readonly string[], optional: readonly string[], target: string): void {
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !(key in record));
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unexpected.length > 0) throw new PublicationError(target, `invalid keys (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`);
}
function assertString(value: unknown, target: string): string {
  if (typeof value !== "string" || value.length === 0) throw new PublicationError(target, "must be a non-empty string");
  return value;
}
function assertLiteral(value: unknown, expected: string, target: string): void {
  if (value !== expected) throw new PublicationError(target, `must be '${expected}'`);
}
function assertSha256(value: unknown, target: string): string {
  const digest = assertString(value, target);
  if (!SHA256_PATTERN.test(digest)) throw new PublicationError(target, "must be a lowercase SHA-256 digest");
  return digest;
}
function assertDate(value: unknown, target: string): string {
  const date = assertString(value, target);
  if (!Number.isFinite(Date.parse(date))) throw new PublicationError(target, "must be an ISO date-time");
  return date;
}
function assertRelativePath(value: unknown, target: string): string {
  const path = assertString(value, target);
  if (path.startsWith("/") || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) throw new PublicationError(target, "must be a safe relative path");
  return path;
}
