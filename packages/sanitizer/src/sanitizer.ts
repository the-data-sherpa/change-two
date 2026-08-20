import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { materializeCapture, verifyBundle } from "@change-two/evidence";
import { SanitizerSchemas } from "./schemas.js";
import { SANITIZATION_SCHEMA_VERSION, SanitizationError, type AmbiguityResolution, type ApprovalRequest, type FindingCategory, type FindingDisposition, type PublicationApproval, type PublicationEnvelope, type RetentionEvent, type RetentionRecord, type RetentionRequest, type SanitizeRequest, type SanitizationFinding, type SanitizationPolicy, type SanitizationReport, type SanitizationScan, type ScanOptions, type TransformationRecord } from "./types.js";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const ENVELOPE_ENTRIES = ["bundle", "publication-approval.json", "retention-record.json", "sanitization-report.json"] as const;
interface Rule { id: string; category: FindingCategory; disposition: FindingDisposition; reason: string; pattern: RegExp; replacement?: string }
const RULES: readonly Rule[] = [
  { id: "credential-key-value", category: "credential", disposition: "redact", reason: "Credential values are replaced without changing evidence meaning.", pattern: /\b(api[_-]?key|client[_-]?secret|access[_-]?token|secret)\b(\s*[:=]\s*["']?)([A-Za-z0-9_./+=-]{12,})/gi, replacement: "$1$2[REDACTED:CREDENTIAL]" },
  { id: "credential-provider-token", category: "credential", disposition: "redact", reason: "Provider credentials are replaced with a typed marker.", pattern: /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|ct_test_[A-Za-z0-9]{20,})\b/g, replacement: "[REDACTED:CREDENTIAL]" },
  { id: "authentication-bearer", category: "authentication", disposition: "redact", reason: "Bearer material is replaced while preserving the scheme.", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, replacement: "Bearer [REDACTED:AUTHENTICATION]" },
  { id: "authentication-session", category: "authentication", disposition: "redact", reason: "Session and cookie values are replaced.", pattern: /\b(cookie|session[_-]?(?:id|token)|authorization)\b(\s*[:=]\s*["']?)([^\s"';,]{12,})/gi, replacement: "$1$2[REDACTED:AUTHENTICATION]" },
  { id: "authentication-private-key", category: "authentication", disposition: "redact", reason: "Private key material is replaced.", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g, replacement: "[REDACTED:PRIVATE-KEY]" },
  { id: "private-path-posix-home", category: "private-path", disposition: "redact", reason: "The private user component is removed while the path suffix remains traceable.", pattern: /\/(home|Users)\/[^/\s"']+(?=\/)/g, replacement: "/$1/[USER]" },
  { id: "private-path-windows-home", category: "private-path", disposition: "redact", reason: "The private Windows user component is removed while the path suffix remains traceable.", pattern: /\b([A-Za-z]):\\+Users\\+[^\\\s"']+(?=\\+)/g, replacement: "$1:\\Users\\[USER]" },
  { id: "unrelated-session-history", category: "unrelated-history", disposition: "block", reason: "Unrelated history cannot be removed without changing evidence.", pattern: /\b(?:UNRELATED_SESSION_HISTORY|unrelatedSessionHistory|sessionHistory)\b/g },
  { id: "unreleased-content-marker", category: "unreleased-content", disposition: "block", reason: "Unreleased Change or Hidden Check content cannot enter a public bundle.", pattern: /\b(?:UNRELEASED_CHANGE|UNRELEASED_HIDDEN_CHECK|FUTURE_HIDDEN_CHECK)\b/g },
  { id: "ambiguous-sensitive-content", category: "ambiguous", disposition: "ambiguous", reason: "Uncertain sensitive content requires quarantine review.", pattern: /\b(?:AMBIGUOUS_SENSITIVE|POSSIBLE_SECRET|REVIEW_REQUIRED_SENSITIVE)\b/g },
];

export function readSanitizationPolicy(path: string): SanitizationPolicy { return new SanitizerSchemas().validate<SanitizationPolicy>("policy", readJson(path), path); }

export function scanBundle(sourceBundleDirectory: string, policy: SanitizationPolicy, options: ScanOptions = {}): SanitizationScan {
  const schemas = new SanitizerSchemas();
  schemas.validate("policy", policy, "sanitization policy");
  const source = resolve(sourceBundleDirectory);
  const verified = verifyBundle(source);
  const sourceBundle = { revisionId: verified.revisionId, contentSetSha256: verified.contentSetSha256 };
  const policyIdentity = { releaseId: policy.releaseId, sha256: sha256(canonicalJson(policy)) };
  const findings = scanVerifiedBundle(source, policy);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  assertDateTime(generatedAt, "scan generatedAt");
  const scan: SanitizationScan = { schemaType: "sanitization-scan", schemaVersion: SANITIZATION_SCHEMA_VERSION, scanId: `scan:${sha256(`${sourceBundle.contentSetSha256}:${policyIdentity.sha256}`)}`, generatedAt, sourceBundle, policy: policyIdentity, status: findings.some((finding) => finding.disposition !== "redact") ? "quarantined" : findings.length ? "redactable" : "clean", findings };
  return schemas.validate<SanitizationScan>("scan", scan, "sanitization scan");
}

export function writeSanitizationScan(path: string, scan: SanitizationScan): void { new SanitizerSchemas().validate("scan", scan, "sanitization scan"); writeNewJson(path, scan); }

export function sanitizeBundle(sourceBundleDirectory: string, publicationDirectory: string, policy: SanitizationPolicy, request: SanitizeRequest): SanitizationReport {
  assertDateTime(request.generatedAt, "sanitization generatedAt");
  if (!request.reportId) throw new SanitizationError("reportId is required.");
  const source = resolve(sourceBundleDirectory); const publication = resolve(publicationDirectory);
  if (source === publication || publication.startsWith(`${source}${sep}`)) throw new SanitizationError("Publication output must be separate from source evidence.");
  if (existsSync(publication)) throw new SanitizationError("Publication directory already exists.");
  const snapshot = snapshotFiles(source);
  const scan = scanBundle(source, policy, { generatedAt: request.generatedAt });
  const ambiguityResolutions = validateAmbiguityResolutions(scan.findings, request.ambiguityResolutions ?? []);
  const resolvedFindingIds = new Set(ambiguityResolutions.map((resolution) => resolution.findingId));
  const unsafe = scan.findings.filter((finding) => finding.disposition === "block" || (finding.disposition === "ambiguous" && !resolvedFindingIds.has(finding.findingId)));
  if (unsafe.length) throw new SanitizationError("Bundle remains quarantined.", unsafe);
  mkdirSync(dirname(publication), { recursive: true });
  const temporary = mkdtempSync(join(dirname(publication), `.sanitizer-${basename(publication)}-`));
  const capture = join(temporary, "capture"); const staging = join(temporary, "publication"); const bundle = join(staging, "bundle");
  mkdirSync(capture, { recursive: true }); mkdirSync(staging, { recursive: true });
  try {
    createSanitizedCapture(source, capture);
    materializeCapture(join(capture, "capture.jsonl"), bundle);
    const verified = verifyBundle(bundle);
    const report: SanitizationReport = { schemaType: "sanitization-report", schemaVersion: SANITIZATION_SCHEMA_VERSION, reportId: request.reportId, generatedAt: request.generatedAt, sourceBundle: scan.sourceBundle, sanitizedBundle: { revisionId: verified.revisionId, contentSetSha256: verified.contentSetSha256 }, policy: scan.policy, status: "passed", findings: scan.findings, ambiguityResolutions, transformations: buildTransformations(source, bundle, scan.findings), blockers: [], ambiguities: [] };
    const schemas = new SanitizerSchemas(); schemas.validate("report", report, "sanitization report");
    const retention: RetentionRecord = { schemaType: "retention-record", schemaVersion: SANITIZATION_SCHEMA_VERSION, sourceContentSetSha256: scan.sourceBundle.contentSetSha256, publicationApprovedAt: null, destructionDueAt: null, events: [] };
    schemas.validate("retention", retention, "retention record");
    writeFileSync(join(staging, "sanitization-report.json"), prettyJson(report)); writeFileSync(join(staging, "retention-record.json"), prettyJson(retention));
    assertSnapshotUnchanged(source, snapshot); renameSync(staging, publication); return report;
  } catch (error) { assertSnapshotUnchanged(source, snapshot); throw error; }
  finally { rmSync(temporary, { force: true, recursive: true }); }
}

export function approvePublication(publicationDirectory: string, request: ApprovalRequest): PublicationApproval {
  const publication = resolve(publicationDirectory); assertCandidateEntries(publication);
  const schemas = new SanitizerSchemas();
  const report = schemas.validate<SanitizationReport>("report", readJson(join(publication, "sanitization-report.json")), "sanitization-report.json");
  const verified = verifyBundle(join(publication, "bundle"));
  if (report.blockers.length || report.ambiguities.length || report.sanitizedBundle.contentSetSha256 !== verified.contentSetSha256) throw new SanitizationError("Only a verified blocker-free sanitization may be approved.");
  if (request.approver.kind !== "human") throw new SanitizationError("Approval must come from a human.");
  assertHttpsUrl(request.immutableReleaseAssetUrl);
  const approval: PublicationApproval = { schemaType: "publication-approval", schemaVersion: SANITIZATION_SCHEMA_VERSION, approvalId: request.approvalId, reportId: report.reportId, sanitizedContentSetSha256: verified.contentSetSha256, decision: "approved", evidenceClass: request.evidenceClass, ...(request.immutableReleaseAssetUrl === undefined ? {} : { immutableReleaseAssetUrl: request.immutableReleaseAssetUrl }), approvedAt: request.approvedAt, approver: request.approver, statement: request.statement };
  schemas.validate("approval", approval, "publication approval");
  const retentionPath = join(publication, "retention-record.json"); const retention = schemas.validate<RetentionRecord>("retention", readJson(retentionPath), retentionPath);
  if (retention.publicationApprovedAt !== null || retention.events.length) throw new SanitizationError("Approval is immutable and already initialized.");
  const due = new Date(parseDate(request.approvedAt, "approvedAt").getTime() + RETENTION_MS).toISOString();
  const initialized: RetentionRecord = { ...retention, publicationApprovedAt: request.approvedAt, destructionDueAt: due, events: [{ eventId: `scheduled:${request.approvalId}`, eventType: "scheduled", recordedAt: request.approvedAt, actor: request.approver, reason: "Destroy restricted source evidence no later than 30 days after publication approval." }] };
  schemas.validate("retention", initialized, "retention record"); writeAtomic(retentionPath, prettyJson(initialized)); writeNewJson(join(publication, "publication-approval.json"), approval); return approval;
}

export function recordRetention(publicationDirectory: string, sourceBundleDirectory: string, request: RetentionRequest): RetentionRecord {
  const publication = resolve(publicationDirectory); const source = resolve(sourceBundleDirectory); const schemas = new SanitizerSchemas();
  const report = schemas.validate<SanitizationReport>("report", readJson(join(publication, "sanitization-report.json")), "sanitization-report.json"); schemas.validate("approval", readJson(join(publication, "publication-approval.json")), "publication-approval.json");
  const retentionPath = join(publication, "retention-record.json"); const retention = schemas.validate<RetentionRecord>("retention", readJson(retentionPath), retentionPath);
  if (!retention.destructionDueAt) throw new SanitizationError("Retention cannot change before approval.");
  if (retention.events.some((event) => event.eventId === request.eventId)) throw new SanitizationError("Retention event IDs are immutable and unique.");
  assertDateTime(request.recordedAt, "recordedAt"); const hold = findActiveHold(retention.events); let event: RetentionEvent;
  if (request.action === "hold") {
    if (request.actor.kind !== "human" || !request.incidentReference || hold) throw new SanitizationError("A documented human incident hold is required.");
    if (parseDate(request.recordedAt, "recordedAt").getTime() > parseDate(retention.destructionDueAt, "destructionDueAt").getTime()) throw new SanitizationError("A hold cannot be placed after the deadline.");
    event = { eventId: request.eventId, eventType: "hold-placed", recordedAt: request.recordedAt, actor: request.actor, reason: request.reason, incidentReference: request.incidentReference };
  } else if (request.action === "release-hold") {
    if (request.actor.kind !== "human" || !hold?.incidentReference) throw new SanitizationError("A human may release an active documented hold only.");
    event = { eventId: request.eventId, eventType: "hold-released", recordedAt: request.recordedAt, actor: request.actor, reason: request.reason, incidentReference: hold.incidentReference };
  } else {
    if (hold) throw new SanitizationError("Source evidence is under incident hold.");
    if (parseDate(request.recordedAt, "recordedAt").getTime() < parseDate(retention.destructionDueAt, "destructionDueAt").getTime()) throw new SanitizationError("Destruction cannot be recorded before the 30-day deadline.");
    if (verifyBundle(source).contentSetSha256 !== report.sourceBundle.contentSetSha256) throw new SanitizationError("Retention source does not match the recorded source bundle.");
    event = { eventId: request.eventId, eventType: "destroyed", recordedAt: request.recordedAt, actor: request.actor, reason: request.reason }; rmSync(source, { recursive: true });
  }
  const updated: RetentionRecord = { ...retention, events: [...retention.events, event] }; schemas.validate("retention", updated, "retention record"); writeAtomic(retentionPath, prettyJson(updated)); return updated;
}

export function assertPublicationReady(publicationDirectory: string, options: { readonly now?: string } = {}): PublicationEnvelope {
  const publication = resolve(publicationDirectory); assertExactEntries(publication); const schemas = new SanitizerSchemas();
  const report = schemas.validate<SanitizationReport>("report", readJson(join(publication, "sanitization-report.json")), "sanitization-report.json"); const approval = schemas.validate<PublicationApproval>("approval", readJson(join(publication, "publication-approval.json")), "publication-approval.json"); const retention = schemas.validate<RetentionRecord>("retention", readJson(join(publication, "retention-record.json")), "retention-record.json");
  const bundleDirectory = join(publication, "bundle"); const verified = verifyBundle(bundleDirectory);
  if (report.blockers.length || report.ambiguities.length || report.sanitizedBundle.revisionId !== verified.revisionId || report.sanitizedBundle.contentSetSha256 !== verified.contentSetSha256) throw new SanitizationError("Report does not identify a verified blocker-free bundle.");
  if (approval.reportId !== report.reportId || approval.sanitizedContentSetSha256 !== verified.contentSetSha256 || approval.approver.kind !== "human") throw new SanitizationError("Approval does not identify this bundle."); assertHttpsUrl(approval.immutableReleaseAssetUrl);
  if (retention.sourceContentSetSha256 !== report.sourceBundle.contentSetSha256 || retention.publicationApprovedAt !== approval.approvedAt || !retention.destructionDueAt) throw new SanitizationError("Retention does not identify this publication.");
  const expectedDue = new Date(parseDate(approval.approvedAt, "approvedAt").getTime() + RETENTION_MS).toISOString(); if (retention.destructionDueAt !== expectedDue) throw new SanitizationError("Destruction deadline must be exactly 30 days after approval.");
  if (!retention.events.some((event) => event.eventType === "scheduled" && event.recordedAt === approval.approvedAt)) throw new SanitizationError("Retention schedule is missing.");
  const overdue = parseDate(options.now ?? new Date().toISOString(), "readiness time").getTime() >= parseDate(retention.destructionDueAt, "destructionDueAt").getTime();
  if (overdue && !retention.events.some((event) => event.eventType === "destroyed") && !findActiveHold(retention.events)) throw new SanitizationError("Source evidence is overdue without a hold.");
  return { directory: publication, bundleDirectory, report, approval, retention };
}

function validateAmbiguityResolutions(findings: readonly SanitizationFinding[], resolutions: readonly AmbiguityResolution[]): readonly AmbiguityResolution[] {
  const ambiguousFindingIds = new Set(findings.filter((finding) => finding.disposition === "ambiguous").map((finding) => finding.findingId));
  const seen = new Set<string>();
  for (const resolution of resolutions) {
    if (!ambiguousFindingIds.has(resolution.findingId)) throw new SanitizationError(`Ambiguity resolution does not identify a current ambiguous finding: ${resolution.findingId}`);
    if (seen.has(resolution.findingId)) throw new SanitizationError(`Ambiguity finding was resolved more than once: ${resolution.findingId}`);
    if (resolution.decision !== "not-sensitive" || resolution.reviewer?.kind !== "human" || !resolution.reviewer.identifier || !resolution.reason) throw new SanitizationError("Each ambiguity resolution requires a human reviewer, a reason, and a not-sensitive decision.");
    assertDateTime(resolution.reviewedAt, "ambiguity reviewedAt");
    seen.add(resolution.findingId);
  }
  return resolutions;
}

function scanVerifiedBundle(source: string, policy: SanitizationPolicy): SanitizationFinding[] {
  const findings: SanitizationFinding[] = [];
  for (const path of listFiles(source)) {
    if (path === "checksums.json") continue; const bytes = readFileSync(join(source, path)); const sourceSha = sha256(bytes); const text = decodeText(bytes);
    if (text === undefined) { findings.push(finding(path, "unscannable-binary", "ambiguous", "ambiguous", "Binary evidence requires quarantine review.", sourceSha, bytes, 0)); continue; }
    const redactions: { start: number; end: number }[] = [];
    for (const rule of RULES) for (const match of text.matchAll(cloneRegex(rule.pattern))) { const offset = match.index ?? 0; findings.push(finding(path, rule.id, rule.category, rule.disposition, rule.reason, sourceSha, match[0] ?? "", offset)); if (rule.disposition === "redact") redactions.push({ start: offset, end: offset + (match[0]?.length ?? 0) }); }
    for (const match of text.matchAll(/[A-Za-z0-9+/_=-]{32,}/g)) { const token = match[0] ?? ""; const start = match.index ?? 0; if (!redactions.some((range) => start < range.end && start + token.length > range.start) && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(token) && entropy(token) >= 4.3) findings.push(finding(path, "ambiguous-high-entropy-token", "ambiguous", "ambiguous", "An unclassified high-entropy token requires review.", sourceSha, token, start)); }
  }
  const manifestPath = join(source, "manifest.json"); const manifest = readJson(manifestPath) as Record<string, unknown>;
  if (typeof manifest.changeId !== "string" || !policy.releasedChangeIds.includes(manifest.changeId)) findings.push(finding("manifest.json", "unreleased-change-id", "unreleased-content", "block", "The Change is not released.", sha256(readFileSync(manifestPath)), String(manifest.changeId), 0));
  const hiddenPath = join(source, "hidden-results.json"); const hidden = readJson(hiddenPath) as { results?: readonly { checkId?: unknown }[] };
  for (const [index, result] of (hidden.results ?? []).entries()) if (typeof result.checkId !== "string" || !policy.releasedHiddenCheckIds.includes(result.checkId)) findings.push(finding(`hidden-results.json#/results/${index}/checkId`, "unreleased-hidden-check-id", "unreleased-content", "block", "The Hidden Check is not released.", sha256(readFileSync(hiddenPath)), String(result.checkId), index));
  const unique = new Map(findings.map((item) => [item.findingId, item])); return [...unique.values()].toSorted((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule));
}

function createSanitizedCapture(source: string, capture: string): void {
  const events = parseJsonLines(join(source, "trajectory.jsonl")).map((value) => redactValue(value) as Record<string, unknown>); const checksums = readJson(join(source, "checksums.json")) as { entries: readonly { kind: string; path: string }[] }; const artifactChecksums = new Map<string, string>();
  for (const entry of checksums.entries) if (entry.kind === "external-artifact") { const text = decodeText(readFileSync(safeChild(source, entry.path))); if (text === undefined) throw new SanitizationError(`Artifact '${entry.path}' cannot be sanitized.`); const sanitized = applyRedactions(text); const target = safeChild(capture, entry.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, sanitized); artifactChecksums.set(entry.path, sha256(sanitized)); }
  for (const event of events) { event.schemaType = "capture-event"; updateChecksums(event, artifactChecksums); }
  writeFileSync(join(capture, "capture.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}
function redactValue(value: unknown): unknown { if (typeof value === "string") return applyRedactions(value); if (Array.isArray(value)) return value.map(redactValue); if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)])); return value; }
function applyRedactions(text: string): string { let output = text; for (const rule of RULES) if (rule.disposition === "redact" && rule.replacement) output = output.replace(cloneRegex(rule.pattern), rule.replacement); return output; }
function updateChecksums(value: unknown, checksums: ReadonlyMap<string, string>): void { if (Array.isArray(value)) { for (const item of value) updateChecksums(item, checksums); return; } if (!isRecord(value)) return; if (typeof value.path === "string" && typeof value.sha256 === "string" && checksums.has(value.path)) value.sha256 = checksums.get(value.path) as string; for (const item of Object.values(value)) updateChecksums(item, checksums); }
function buildTransformations(source: string, sanitized: string, findings: readonly SanitizationFinding[]): TransformationRecord[] {
  const rulesByPath = new Map<string, Rule[]>(); for (const item of findings) { const path = item.path.split("#", 1)[0] as string; const rule = RULES.find((candidate) => candidate.id === item.rule); if (!rule || rule.disposition !== "redact") continue; const rules = rulesByPath.get(path) ?? []; if (!rules.includes(rule)) { rules.push(rule); rulesByPath.set(path, rules); } }
  const records: TransformationRecord[] = []; for (const path of listFiles(sanitized)) { const sourcePath = join(source, path); if (!existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) continue; const sourceSha256 = sha256(readFileSync(sourcePath)); const sanitizedSha256 = sha256(readFileSync(join(sanitized, path))); if (sourceSha256 === sanitizedSha256) continue; const rules = rulesByPath.get(path); records.push({ sourcePath: path, sourceSha256, sanitizedPath: path, sanitizedSha256, rule: rules?.map((rule) => rule.id).sort().join(",") ?? "evidence-rematerialization", reason: rules?.map((rule) => rule.reason).sort().join(" ") ?? "Derived evidence and checksums were regenerated after redaction." }); } return records.toSorted((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

function assertCandidateEntries(directory: string): void { const expected = ["bundle", "retention-record.json", "sanitization-report.json"]; const entries = existsSync(directory) ? readdirSync(directory).toSorted() : []; if (entries.length !== expected.length || entries.some((entry, index) => entry !== expected[index])) throw new SanitizationError("Candidate publication has undeclared entries."); }
function assertExactEntries(directory: string): void { const entries = existsSync(directory) ? readdirSync(directory).toSorted() : []; if (entries.length !== ENVELOPE_ENTRIES.length || entries.some((entry, index) => entry !== ENVELOPE_ENTRIES[index])) throw new SanitizationError("Publication envelope must have exactly four entries."); for (const entry of entries) if (lstatSync(join(directory, entry)).isSymbolicLink()) throw new SanitizationError("Envelope symlinks are forbidden."); }
function findActiveHold(events: readonly RetentionEvent[]): RetentionEvent | undefined { let active: RetentionEvent | undefined; for (const event of events) { if (event.eventType === "hold-placed") active = event; else if (event.eventType === "hold-released") active = undefined; } return active; }
function snapshotFiles(directory: string): ReadonlyMap<string, Buffer> { return new Map(listFiles(directory).map((path) => [path, readFileSync(join(directory, path))])); }
function assertSnapshotUnchanged(directory: string, snapshot: ReadonlyMap<string, Buffer>): void { if (listFiles(directory).length !== snapshot.size) throw new SanitizationError("Source evidence changed."); for (const [path, bytes] of snapshot) if (!existsSync(join(directory, path)) || !readFileSync(join(directory, path)).equals(bytes)) throw new SanitizationError(`Source evidence changed: ${path}`); }
function listFiles(directory: string): string[] { const files: string[] = []; const visit = (current: string): void => { for (const entry of readdirSync(current, { withFileTypes: true })) { const path = join(current, entry.name); if (entry.isSymbolicLink()) throw new SanitizationError(`Symlink forbidden: ${relative(directory, path)}`); if (entry.isDirectory()) visit(path); else if (entry.isFile()) files.push(relative(directory, path).split(sep).join("/")); } }; visit(directory); return files.toSorted(); }
function safeChild(root: string, child: string): string { const absolute = resolve(root); const candidate = resolve(absolute, child); if (!candidate.startsWith(`${absolute}${sep}`)) throw new SanitizationError("Evidence path escapes bundle."); return candidate; }
function decodeText(bytes: Buffer): string | undefined { if (bytes.includes(0)) return undefined; const text = bytes.toString("utf8"); return Buffer.from(text).equals(bytes) ? text : undefined; }
function finding(path: string, rule: string, category: FindingCategory, disposition: FindingDisposition, reason: string, sourceSha256: string, match: string | Buffer, offset: number): SanitizationFinding { const matchSha256 = sha256(match); return { findingId: `finding:${sha256(`${path}:${rule}:${offset}:${matchSha256}`)}`, path: `${path}#offset=${offset}`, rule, category, disposition, reason, sourceSha256, matchSha256 }; }
function entropy(value: string): number { const counts = new Map<string, number>(); for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1); let result = 0; for (const count of counts.values()) { const probability = count / value.length; result -= probability * Math.log2(probability); } return result; }
function cloneRegex(pattern: RegExp): RegExp { return new RegExp(pattern.source, pattern.flags); }
function parseJsonLines(path: string): unknown[] { return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => { try { return JSON.parse(line) as unknown; } catch { throw new SanitizationError(`Invalid JSON at ${path}:${index + 1}.`); } }); }
function readJson(path: string): unknown { try { return JSON.parse(readFileSync(path, "utf8")) as unknown; } catch (error) { throw new SanitizationError(`Could not read JSON '${path}': ${error instanceof Error ? error.message : String(error)}`); } }
function writeNewJson(path: string, value: unknown): void { mkdirSync(dirname(resolve(path)), { recursive: true }); writeFileSync(resolve(path), prettyJson(value), { encoding: "utf8", flag: "wx" }); }
function writeAtomic(path: string, bytes: string): void { const temporary = `${path}.tmp-${process.pid}`; writeFileSync(temporary, bytes, { encoding: "utf8", flag: "wx" }); renameSync(temporary, path); }
function prettyJson(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`; }
function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function parseDate(value: string, name: string): Date { assertDateTime(value, name); return new Date(value); }
function assertDateTime(value: string, name: string): void { const parsed = new Date(value); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new SanitizationError(`${name} must be a canonical UTC timestamp.`); }
function assertHttpsUrl(value: string | null | undefined): void { if (value == null) return; let url: URL; try { url = new URL(value); } catch { throw new SanitizationError("Release asset URL must be HTTPS."); } if (url.protocol !== "https:") throw new SanitizationError("Release asset URL must be HTTPS."); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
