import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { canonicalJson, sha256 } from "./canonical.js";
import { EvidenceSchemas, issue } from "./schemas.js";
import {
  EvidenceError,
  SCHEMA_VERSION,
  type ArtifactReference,
  type BundleRevision,
  type CaptureEvent,
  type ChecksumEntry,
  type ChecksumManifest,
  type CorrectionRequest,
  type ValidationIssue,
} from "./types.js";

const REQUIRED_CONTENT_FILES = [
  "manifest.json",
  "requirement.md",
  "environment.json",
  "trajectory.jsonl",
  "interventions.jsonl",
  "submitted.patch",
  "repository-state.json",
  "costs.json",
  "visible-results.json",
  "hidden-results.json",
  "reviewer-findings.json",
  "summary.json",
] as const;

const JSON_EVENT_TARGETS: Readonly<Record<string, { readonly path: string; readonly schema: string }>> = {
  manifest: { path: "manifest.json", schema: "manifest" },
  environment: { path: "environment.json", schema: "environment" },
  "repository-state": { path: "repository-state.json", schema: "repository-state" },
  costs: { path: "costs.json", schema: "costs" },
  "visible-results": { path: "visible-results.json", schema: "visible-results" },
  "hidden-results": { path: "hidden-results.json", schema: "hidden-results" },
  "reviewer-findings": { path: "reviewer-findings.json", schema: "reviewer-findings" },
  summary: { path: "summary.json", schema: "summary" },
};

const TEXT_EVENT_TARGETS: Readonly<Record<string, { readonly path: string; readonly schema: string }>> = {
  requirement: { path: "requirement.md", schema: "requirement" },
  "submitted-patch": { path: "submitted.patch", schema: "submitted-patch" },
};

interface LoadedCapture {
  readonly capturePath: string;
  readonly events: readonly CaptureEvent[];
  readonly singletons: Readonly<Record<string, unknown>>;
  readonly interventions: readonly unknown[];
  readonly artifacts: readonly ArtifactReference[];
}

interface ParsedBundle {
  readonly manifest: Record<string, unknown>;
  readonly trajectory: readonly CaptureEvent[];
  readonly interventions: readonly Record<string, unknown>[];
  readonly visibleResults: Record<string, unknown>;
  readonly hiddenResults: Record<string, unknown>;
  readonly reviewerFindings: Record<string, unknown>;
  readonly summary: Record<string, unknown>;
  readonly checksums: ChecksumManifest;
  readonly artifacts: readonly ArtifactReference[];
}

interface RevisionContext {
  readonly request: CorrectionRequest;
  readonly supersededRevisionId: string;
  readonly supersededChecksums: ChecksumManifest;
}

export interface MaterializeResult {
  readonly bundleDirectory: string;
  readonly contentSetSha256: string;
  readonly revisionId: string;
}

export function materializeCapture(capturePath: string, bundleDirectory: string): MaterializeResult {
  const schemas = new EvidenceSchemas();
  const capture = loadCapture(resolve(capturePath), schemas);
  return writeBundle(capture, resolve(bundleDirectory), schemas, undefined);
}

export function replayCapture(capturePath: string, bundleDirectory: string): MaterializeResult {
  return materializeCapture(capturePath, bundleDirectory);
}

export function verifyBundle(bundleDirectory: string): MaterializeResult {
  const absoluteBundle = resolve(bundleDirectory);
  const schemas = new EvidenceSchemas();
  const parsed = parseAndValidateBundle(absoluteBundle, schemas);
  verifyBundleSemantics(absoluteBundle, parsed, schemas);
  const revisionId = requiredString(parsed.manifest, "bundleRevisionId", "manifest.json");
  return {
    bundleDirectory: absoluteBundle,
    contentSetSha256: parsed.checksums.contentSetSha256,
    revisionId,
  };
}

export function createCorrection(
  capturePath: string,
  previousBundleDirectory: string,
  newBundleDirectory: string,
  correctionRequestPath: string,
): MaterializeResult {
  const schemas = new EvidenceSchemas();
  const previousDirectory = resolve(previousBundleDirectory);
  const newDirectory = resolve(newBundleDirectory);
  if (previousDirectory === newDirectory) {
    throw new EvidenceError(newDirectory, [
      issue("/", "immutable", "a correction must use a new bundle directory"),
    ]);
  }

  const previousSnapshot = snapshotFiles(previousDirectory);
  const previous = parseAndValidateBundle(previousDirectory, schemas);
  verifyBundleSemantics(previousDirectory, previous, schemas);
  const requestValue = readJson(resolve(correctionRequestPath));
  const request = schemas.validate<CorrectionRequest>(
    "correction-request",
    requestValue,
    correctionRequestPath,
  );
  const supersededRevisionId = requiredString(
    previous.manifest,
    "bundleRevisionId",
    "manifest.json",
  );
  if (request.revisionId === supersededRevisionId) {
    throw new EvidenceError(correctionRequestPath, [
      issue("/revisionId", "immutable", "must identify a new Bundle Revision"),
    ]);
  }

  const capture = loadCapture(resolve(capturePath), schemas);
  const manifest = capture.singletons.manifest as Record<string, unknown>;
  if (manifest.bundleRevisionId !== request.revisionId) {
    throw new EvidenceError(capturePath, [
      issue(
        "/manifest/bundleRevisionId",
        "reference",
        `must equal correction revision '${request.revisionId}'`,
      ),
    ]);
  }

  const result = writeBundle(capture, newDirectory, schemas, {
    request,
    supersededChecksums: previous.checksums,
    supersededRevisionId,
  });
  assertSnapshotUnchanged(previousDirectory, previousSnapshot);
  return result;
}

function loadCapture(capturePath: string, schemas: EvidenceSchemas): LoadedCapture {
  if (!existsSync(capturePath) || !lstatSync(capturePath).isFile()) {
    throw new EvidenceError(capturePath, [issue("/", "missing", "capture JSONL file does not exist")]);
  }
  const events = parseJsonLines(capturePath).map((value, index) =>
    schemas.validate<CaptureEvent>("capture-event", value, `${capturePath}:${index + 1}`),
  );
  if (events.length === 0) {
    throw new EvidenceError(capturePath, [issue("/", "minItems", "must contain Capture Events")]);
  }

  const issues = validateEventOrder(events);
  const runId = events[0]?.runId;
  const eventIds = new Set<string>();
  const singletonValues: Record<string, unknown> = {};
  const interventions: unknown[] = [];

  for (const [index, event] of events.entries()) {
    const eventPath = `/${index}`;
    if (event.runId !== runId) {
      issues.push(issue(`${eventPath}/runId`, "const", `must equal '${String(runId)}'`));
    }
    if (eventIds.has(event.eventId)) {
      issues.push(issue(`${eventPath}/eventId`, "unique", `duplicates '${event.eventId}'`));
    }
    eventIds.add(event.eventId);

    const jsonTarget = JSON_EVENT_TARGETS[event.eventType];
    const textTarget = TEXT_EVENT_TARGETS[event.eventType];
    if (jsonTarget !== undefined || textTarget !== undefined) {
      if (event.payload === undefined || event.artifactReference !== undefined) {
        issues.push(issue(eventPath, "payload", `${event.eventType} must carry an inline payload`));
        continue;
      }
      if (singletonValues[event.eventType] !== undefined) {
        issues.push(issue(`${eventPath}/eventType`, "unique", `duplicates '${event.eventType}'`));
        continue;
      }
      try {
        const target = jsonTarget ?? textTarget;
        if (target === undefined) {
          throw new Error("unreachable evidence target");
        }
        singletonValues[event.eventType] = schemas.validate(
          target.schema,
          event.payload,
          `${capturePath}:${index + 1}`,
        );
      } catch (error) {
        if (error instanceof EvidenceError) {
          issues.push(...error.issues.map((entry) => ({
            ...entry,
            path: `${eventPath}/payload${entry.path === "/" ? "" : entry.path}`,
          })));
        } else {
          throw error;
        }
      }
    } else if (event.eventType === "intervention") {
      if (event.payload === undefined || event.artifactReference !== undefined) {
        issues.push(issue(eventPath, "payload", "intervention must carry an inline payload"));
        continue;
      }
      try {
        const intervention = schemas.validate<Record<string, unknown>>(
          "intervention-event",
          event.payload,
          `${capturePath}:${index + 1}`,
        );
        if (intervention.eventId !== event.eventId) {
          issues.push(issue(`${eventPath}/payload/eventId`, "reference", "must identify its Capture Event"));
        }
        interventions.push(intervention);
      } catch (error) {
        if (error instanceof EvidenceError) {
          issues.push(...error.issues.map((entry) => ({
            ...entry,
            path: `${eventPath}/payload${entry.path === "/" ? "" : entry.path}`,
          })));
        } else {
          throw error;
        }
      }
    } else if (event.eventType === "provider-native" && event.artifactReference === undefined) {
      issues.push(issue(eventPath, "artifactReference", "provider-native must reference immutable bytes"));
    }
  }

  for (const eventType of [...Object.keys(JSON_EVENT_TARGETS), ...Object.keys(TEXT_EVENT_TARGETS)]) {
    if (singletonValues[eventType] === undefined) {
      issues.push(issue("/", "required", `is missing the '${eventType}' Capture Event`));
    }
  }

  const manifest = singletonValues.manifest as Record<string, unknown> | undefined;
  if (manifest !== undefined && manifest.runId !== runId) {
    issues.push(issue("/manifest/runId", "reference", "must equal the Capture Event Run identifier"));
  }
  if (issues.length > 0) {
    throw new EvidenceError(capturePath, issues);
  }

  return {
    artifacts: collectArtifactReferences(events, schemas, capturePath),
    capturePath,
    events,
    interventions,
    singletons: singletonValues,
  };
}

function validateEventOrder(events: readonly CaptureEvent[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let previousElapsed = -1;
  for (const [index, event] of events.entries()) {
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      issues.push(
        issue(
          `/${index}/sequence`,
          "sequence",
          `must be contiguous; expected ${expectedSequence}, received ${event.sequence}`,
        ),
      );
    }
    if (event.elapsedNanoseconds < previousElapsed) {
      issues.push(
        issue(
          `/${index}/elapsedNanoseconds`,
          "monotonic",
          "must not decrease; wall-clock timestamps do not determine event order",
        ),
      );
    }
    previousElapsed = event.elapsedNanoseconds;
  }
  return issues;
}

function writeBundle(
  capture: LoadedCapture,
  bundleDirectory: string,
  schemas: EvidenceSchemas,
  revisionContext: RevisionContext | undefined,
): MaterializeResult {
  if (existsSync(bundleDirectory)) {
    throw new EvidenceError(bundleDirectory, [
      issue("/", "immutable", "bundle directory already exists and will not be overwritten"),
    ]);
  }
  mkdirSync(dirname(bundleDirectory), { recursive: true });
  const temporaryDirectory = mkdtempSync(
    join(dirname(bundleDirectory), `.evidence-${basename(bundleDirectory)}-`),
  );

  try {
    for (const [eventType, target] of Object.entries(JSON_EVENT_TARGETS)) {
      writeFileSync(
        join(temporaryDirectory, target.path),
        canonicalJson(capture.singletons[eventType]),
        "utf8",
      );
    }
    for (const [eventType, target] of Object.entries(TEXT_EVENT_TARGETS)) {
      const value = capture.singletons[eventType];
      if (typeof value !== "string") {
        throw new EvidenceError(capture.capturePath, [
          issue(`/eventType/${eventType}`, "type", "must materialize as text"),
        ]);
      }
      writeFileSync(join(temporaryDirectory, target.path), normalizeText(value), "utf8");
    }

    const trajectory = capture.events.map((event) => ({ ...event, schemaType: "trajectory-event" }));
    writeFileSync(
      join(temporaryDirectory, "trajectory.jsonl"),
      trajectory.map((event) => canonicalJson(event)).join(""),
      "utf8",
    );
    writeFileSync(
      join(temporaryDirectory, "interventions.jsonl"),
      capture.interventions.map((event) => canonicalJson(event)).join(""),
      "utf8",
    );

    copyReferencedArtifacts(capture, temporaryDirectory);
    const contentEntries = checksumContentFiles(temporaryDirectory, capture.artifacts);
    const contentSetSha256 = checksumContentSet(contentEntries);
    let revision: BundleRevision | undefined;
    if (revisionContext !== undefined) {
      const changedArtifacts = changedContentPaths(
        revisionContext.supersededChecksums.entries,
        contentEntries,
      );
      if (changedArtifacts.length === 0) {
        throw new EvidenceError(capture.capturePath, [
          issue("/", "correction", "must change at least one checksummed artifact"),
        ]);
      }
      revision = {
        schemaType: "bundle-revision",
        schemaVersion: SCHEMA_VERSION,
        revisionId: revisionContext.request.revisionId,
        supersededRevisionId: revisionContext.supersededRevisionId,
        reason: revisionContext.request.reason,
        author: revisionContext.request.author,
        timestamp: revisionContext.request.timestamp,
        supersededContentSetSha256: revisionContext.supersededChecksums.contentSetSha256,
        currentContentSetSha256: contentSetSha256,
        changedArtifacts,
      };
      schemas.validate("bundle-revision", revision, "revision.json");
      writeFileSync(join(temporaryDirectory, "revision.json"), canonicalJson(revision), "utf8");
    }

    writeChecksumManifest(temporaryDirectory, contentEntries, contentSetSha256, revision);
    const parsed = parseAndValidateBundle(temporaryDirectory, schemas);
    verifyBundleSemantics(temporaryDirectory, parsed, schemas);
    renameSync(temporaryDirectory, bundleDirectory);
    const manifest = capture.singletons.manifest as Record<string, unknown>;
    return {
      bundleDirectory,
      contentSetSha256,
      revisionId: requiredString(manifest, "bundleRevisionId", "manifest.json"),
    };
  } catch (error) {
    rmSync(temporaryDirectory, { force: true, recursive: true });
    throw error;
  }
}

function copyReferencedArtifacts(capture: LoadedCapture, bundleDirectory: string): void {
  const captureDirectory = dirname(capture.capturePath);
  for (const artifact of capture.artifacts) {
    const sourcePath = safeArtifactPath(captureDirectory, artifact.path, capture.capturePath);
    if (!existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) {
      throw new EvidenceError(capture.capturePath, [
        issue(`/artifact/${artifact.artifactId}`, "reference", `missing artifact '${artifact.path}'`),
      ]);
    }
    const bytes = readFileSync(sourcePath);
    const actualChecksum = sha256(bytes);
    if (actualChecksum !== artifact.sha256) {
      throw new EvidenceError(capture.capturePath, [
        issue(
          `/artifact/${artifact.artifactId}/sha256`,
          "checksum",
          `expected ${artifact.sha256}, received ${actualChecksum}`,
        ),
      ]);
    }
    const targetPath = safeArtifactPath(bundleDirectory, artifact.path, capture.capturePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    if (existsSync(targetPath)) {
      if (sha256(readFileSync(targetPath)) !== artifact.sha256) {
        throw new EvidenceError(capture.capturePath, [
          issue(`/artifact/${artifact.artifactId}`, "collision", `conflicts at '${artifact.path}'`),
        ]);
      }
    } else {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function safeArtifactPath(root: string, artifactPath: string, target: string): string {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, artifactPath);
  if (!artifactPath.startsWith("artifacts/") || !candidate.startsWith(`${absoluteRoot}${sep}`)) {
    throw new EvidenceError(target, [
      issue("/path", "path", `artifact path '${artifactPath}' escapes the artifacts directory`),
    ]);
  }
  return candidate;
}

function checksumContentFiles(
  bundleDirectory: string,
  artifacts: readonly ArtifactReference[],
): ChecksumEntry[] {
  const entries: ChecksumEntry[] = REQUIRED_CONTENT_FILES.map((path) => ({
    kind: "bundle-file",
    mode: "bytes",
    path,
    sha256: sha256(readFileSync(join(bundleDirectory, path))),
  }));
  for (const artifact of artifacts) {
    if (!entries.some((entry) => entry.path === artifact.path)) {
      entries.push({
        kind: "external-artifact",
        mode: "bytes",
        path: artifact.path,
        sha256: artifact.sha256,
      });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function checksumContentSet(entries: readonly ChecksumEntry[]): string {
  return sha256(
    canonicalJson(entries.map(({ path, sha256: digest }) => ({ path, sha256: digest }))),
  );
}

function writeChecksumManifest(
  bundleDirectory: string,
  contentEntries: readonly ChecksumEntry[],
  contentSetSha256: string,
  revision: BundleRevision | undefined,
): void {
  const entries = [...contentEntries];
  if (revision !== undefined) {
    entries.push({
      kind: "revision",
      mode: "bytes",
      path: "revision.json",
      sha256: sha256(readFileSync(join(bundleDirectory, "revision.json"))),
    });
  }
  const selfEntry: ChecksumEntry = {
    kind: "checksum-manifest",
    mode: "self-canonical",
    path: "checksums.json",
    sha256: "0".repeat(64),
  };
  entries.push(selfEntry);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const zeroedManifest: ChecksumManifest = {
    schemaType: "checksums",
    schemaVersion: SCHEMA_VERSION,
    algorithm: "sha256",
    contentSetSha256,
    entries,
  };
  const selfChecksum = sha256(canonicalJson(zeroedManifest));
  const manifest: ChecksumManifest = {
    ...zeroedManifest,
    entries: entries.map((entry) =>
      entry.path === "checksums.json" ? { ...entry, sha256: selfChecksum } : entry,
    ),
  };
  writeFileSync(join(bundleDirectory, "checksums.json"), canonicalJson(manifest), "utf8");
}

function parseAndValidateBundle(bundleDirectory: string, schemas: EvidenceSchemas): ParsedBundle {
  if (!existsSync(bundleDirectory) || !lstatSync(bundleDirectory).isDirectory()) {
    throw new EvidenceError(bundleDirectory, [issue("/", "missing", "bundle directory does not exist")]);
  }
  const values: Record<string, unknown> = {};
  for (const [eventType, target] of Object.entries(JSON_EVENT_TARGETS)) {
    const path = join(bundleDirectory, target.path);
    values[eventType] = schemas.validate(target.schema, readJson(path), target.path);
  }
  schemas.validate("requirement", readRequiredText(join(bundleDirectory, "requirement.md")), "requirement.md");
  schemas.validate(
    "submitted-patch",
    readRequiredText(join(bundleDirectory, "submitted.patch")),
    "submitted.patch",
  );

  const trajectory = parseJsonLines(join(bundleDirectory, "trajectory.jsonl")).map((value, index) => {
    const event = schemas.validate<CaptureEvent>(
      "trajectory-event",
      value,
      `trajectory.jsonl:${index + 1}`,
    );
    return event;
  });
  const interventions = parseJsonLines(join(bundleDirectory, "interventions.jsonl")).map(
    (value, index) =>
      schemas.validate<Record<string, unknown>>(
        "intervention-event",
        value,
        `interventions.jsonl:${index + 1}`,
      ),
  );
  const checksums = schemas.validate<ChecksumManifest>(
    "checksums",
    readJson(join(bundleDirectory, "checksums.json")),
    "checksums.json",
  );
  if (existsSync(join(bundleDirectory, "revision.json"))) {
    schemas.validate(
      "bundle-revision",
      readJson(join(bundleDirectory, "revision.json")),
      "revision.json",
    );
  }

  const artifacts = collectArtifactReferences(
    [
      ...trajectory,
      ...interventions,
      values["visible-results"],
      values["hidden-results"],
      values["reviewer-findings"],
      values.summary,
    ],
    schemas,
    bundleDirectory,
  );
  return {
    artifacts,
    checksums,
    hiddenResults: values["hidden-results"] as Record<string, unknown>,
    interventions,
    manifest: values.manifest as Record<string, unknown>,
    reviewerFindings: values["reviewer-findings"] as Record<string, unknown>,
    summary: values.summary as Record<string, unknown>,
    trajectory,
    visibleResults: values["visible-results"] as Record<string, unknown>,
  };
}

function verifyBundleSemantics(
  bundleDirectory: string,
  bundle: ParsedBundle,
  schemas: EvidenceSchemas,
): void {
  const issues = validateEventOrder(bundle.trajectory);
  const eventIds = new Set(bundle.trajectory.map((event) => event.eventId));
  if (eventIds.size !== bundle.trajectory.length) {
    issues.push(issue("/trajectory", "unique", "contains duplicate event identifiers"));
  }

  const artifactById = new Map<string, ArtifactReference>();
  const artifactPathChecksums = new Map<string, string>();
  for (const artifact of bundle.artifacts) {
    const existingId = artifactById.get(artifact.artifactId);
    if (existingId !== undefined && canonicalJson(existingId) !== canonicalJson(artifact)) {
      issues.push(issue("/artifacts", "unique", `artifact '${artifact.artifactId}' has conflicting references`));
    }
    artifactById.set(artifact.artifactId, artifact);
    const existingChecksum = artifactPathChecksums.get(artifact.path);
    if (existingChecksum !== undefined && existingChecksum !== artifact.sha256) {
      issues.push(issue("/artifacts", "collision", `artifact path '${artifact.path}' has conflicting checksums`));
    }
    artifactPathChecksums.set(artifact.path, artifact.sha256);
    const artifactPath = safeArtifactPath(bundleDirectory, artifact.path, bundleDirectory);
    if (!existsSync(artifactPath) || !lstatSync(artifactPath).isFile()) {
      issues.push(issue(`/artifacts/${artifact.artifactId}`, "reference", `missing '${artifact.path}'`));
    } else if (sha256(readFileSync(artifactPath)) !== artifact.sha256) {
      issues.push(issue(`/artifacts/${artifact.artifactId}/sha256`, "checksum", `does not match '${artifact.path}'`));
    }
  }

  validateSourceEventReferences(bundle, eventIds, issues);
  validateSummaryLinks(bundle, eventIds, artifactById, issues);
  validateChecksums(bundleDirectory, bundle, issues);
  validateRevision(bundleDirectory, bundle, schemas, issues);
  if (issues.length > 0) {
    throw new EvidenceError(bundleDirectory, issues);
  }
}

function validateSourceEventReferences(
  bundle: ParsedBundle,
  eventIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  const documents: readonly unknown[] = [
    ...bundle.interventions,
    bundle.visibleResults,
    bundle.hiddenResults,
    bundle.reviewerFindings,
  ];
  visitValues(documents, (value, path) => {
    if (path.endsWith("/eventId") && typeof value === "string" && !eventIds.has(value)) {
      issues.push(issue(path, "reference", `references unknown Capture Event '${value}'`));
    }
    if (path.includes("/sourceEventIds/") && typeof value === "string" && !eventIds.has(value)) {
      issues.push(issue(path, "reference", `references unknown Capture Event '${value}'`));
    }
  });
}

function validateSummaryLinks(
  bundle: ParsedBundle,
  eventIds: ReadonlySet<string>,
  artifactById: ReadonlyMap<string, ArtifactReference>,
  issues: ValidationIssue[],
): void {
  const visibleIds = resultIdentifiers(bundle.visibleResults, "checkId");
  const hiddenIds = resultIdentifiers(bundle.hiddenResults, "checkId");
  const findingIds = resultIdentifiers(bundle.reviewerFindings, "findingId", "findings");
  const results = Array.isArray(bundle.summary.results) ? bundle.summary.results : [];
  for (const [resultIndex, result] of results.entries()) {
    if (!isRecord(result) || !Array.isArray(result.evidenceLinks)) {
      continue;
    }
    for (const [linkIndex, link] of result.evidenceLinks.entries()) {
      if (typeof link !== "string") {
        continue;
      }
      const separator = link.indexOf(":");
      const kind = link.slice(0, separator);
      const identifier = link.slice(separator + 1);
      let resolves = false;
      switch (kind) {
        case "event":
          resolves = eventIds.has(link);
          break;
        case "artifact":
          resolves = artifactById.has(link);
          break;
        case "visible-result":
          resolves = visibleIds.has(identifier);
          break;
        case "hidden-result":
          resolves = hiddenIds.has(identifier);
          break;
        case "reviewer-finding":
          resolves = findingIds.has(`finding:${identifier}`);
          break;
      }
      if (!resolves) {
        issues.push(
          issue(
            `/summary/results/${resultIndex}/evidenceLinks/${linkIndex}`,
            "reference",
            `does not resolve '${link}'`,
          ),
        );
      }
    }
  }
}

function validateChecksums(
  bundleDirectory: string,
  bundle: ParsedBundle,
  issues: ValidationIssue[],
): void {
  const expectedPaths = new Set<string>(REQUIRED_CONTENT_FILES);
  expectedPaths.add("checksums.json");
  if (existsSync(join(bundleDirectory, "revision.json"))) {
    expectedPaths.add("revision.json");
  }
  for (const artifact of bundle.artifacts) {
    expectedPaths.add(artifact.path);
  }
  const artifactPaths = new Set(bundle.artifacts.map((artifact) => artifact.path));

  const actualFiles = listFiles(bundleDirectory);
  for (const path of expectedPaths) {
    if (!actualFiles.includes(path)) {
      issues.push(issue(`/${path}`, "missing", "required or referenced bundle file is missing"));
    }
  }
  for (const path of actualFiles) {
    if (!expectedPaths.has(path)) {
      issues.push(issue(`/${path}`, "undeclared", "extra file is not declared by the bundle"));
    }
  }

  const entriesByPath = new Map<string, ChecksumEntry>();
  for (const [index, entry] of bundle.checksums.entries.entries()) {
    if (entriesByPath.has(entry.path)) {
      issues.push(issue(`/checksums/entries/${index}/path`, "unique", `duplicates '${entry.path}'`));
    }
    entriesByPath.set(entry.path, entry);
  }
  const sortedEntryPaths = bundle.checksums.entries.map((entry) => entry.path).toSorted();
  if (
    sortedEntryPaths.some(
      (path, index) => bundle.checksums.entries[index]?.path !== path,
    )
  ) {
    issues.push(issue("/checksums/entries", "order", "must be sorted by path"));
  }
  for (const path of expectedPaths) {
    if (!entriesByPath.has(path)) {
      issues.push(issue(`/checksums/entries`, "missing", `does not declare '${path}'`));
    }
  }
  for (const path of entriesByPath.keys()) {
    if (!expectedPaths.has(path)) {
      issues.push(issue(`/checksums/entries`, "undeclared", `declares unknown file '${path}'`));
    }
  }

  for (const [path, entry] of entriesByPath.entries()) {
    if (path === "checksums.json") {
      if (entry.kind !== "checksum-manifest" || entry.mode !== "self-canonical") {
        issues.push(issue("/checksums/entries", "self", "checksums.json must use self-canonical mode"));
      }
      const zeroed: ChecksumManifest = {
        ...bundle.checksums,
        entries: bundle.checksums.entries.map((candidate) =>
          candidate.path === "checksums.json" ? { ...candidate, sha256: "0".repeat(64) } : candidate,
        ),
      };
      const expectedSelfChecksum = sha256(canonicalJson(zeroed));
      if (entry.sha256 !== expectedSelfChecksum) {
        issues.push(issue("/checksums/entries/checksums.json", "checksum", "self-canonical checksum mismatch"));
      }
      continue;
    }
    const expectedKind = path === "revision.json"
      ? "revision"
      : artifactPaths.has(path)
        ? "external-artifact"
        : "bundle-file";
    if (entry.kind !== expectedKind || entry.mode !== "bytes") {
      issues.push(
        issue(
          `/checksums/entries/${path}`,
          "classification",
          `must use kind '${expectedKind}' and byte checksum mode`,
        ),
      );
    }
    const filePath = join(bundleDirectory, path);
    if (existsSync(filePath) && sha256(readFileSync(filePath)) !== entry.sha256) {
      issues.push(issue(`/checksums/entries/${path}`, "checksum", "file checksum mismatch"));
    }
  }

  const contentEntries = bundle.checksums.entries.filter(
    (entry) => entry.kind === "bundle-file" || entry.kind === "external-artifact",
  );
  const expectedContentSet = checksumContentSet(contentEntries);
  if (expectedContentSet !== bundle.checksums.contentSetSha256) {
    issues.push(issue("/checksums/contentSetSha256", "checksum", "content checksum set mismatch"));
  }
  const canonicalChecksumBytes = canonicalJson(bundle.checksums);
  if (
    existsSync(join(bundleDirectory, "checksums.json")) &&
    readFileSync(join(bundleDirectory, "checksums.json"), "utf8") !== canonicalChecksumBytes
  ) {
    issues.push(issue("/checksums.json", "canonical", "must use deterministic canonical serialization"));
  }
}

function validateRevision(
  bundleDirectory: string,
  bundle: ParsedBundle,
  schemas: EvidenceSchemas,
  issues: ValidationIssue[],
): void {
  const revisionPath = join(bundleDirectory, "revision.json");
  if (!existsSync(revisionPath)) {
    return;
  }
  const revision = schemas.validate<BundleRevision>(
    "bundle-revision",
    readJson(revisionPath),
    "revision.json",
  );
  if (revision.revisionId !== bundle.manifest.bundleRevisionId) {
    issues.push(issue("/revision/revisionId", "reference", "must equal manifest bundleRevisionId"));
  }
  if (revision.revisionId === revision.supersededRevisionId) {
    issues.push(issue("/revision/supersededRevisionId", "immutable", "must identify a prior revision"));
  }
  if (revision.currentContentSetSha256 !== bundle.checksums.contentSetSha256) {
    issues.push(issue("/revision/currentContentSetSha256", "reference", "must equal current checksum set"));
  }
}

function collectArtifactReferences(
  values: readonly unknown[],
  schemas: EvidenceSchemas,
  target: string,
): ArtifactReference[] {
  const byId = new Map<string, ArtifactReference>();
  const byPath = new Map<string, ArtifactReference>();
  const issues: ValidationIssue[] = [];
  visitValues(values, (value, path) => {
    if (!isRecord(value) || value.schemaType !== "artifact-reference") {
      return;
    }
    let artifact: ArtifactReference;
    try {
      artifact = schemas.validate<ArtifactReference>("artifact-reference", value, target);
      safeArtifactPath("/evidence-root", artifact.path, target);
    } catch (error) {
      if (error instanceof EvidenceError) {
        issues.push(...error.issues.map((entry) => ({ ...entry, path: `${path}${entry.path}` })));
        return;
      }
      throw error;
    }
    const previousId = byId.get(artifact.artifactId);
    if (previousId !== undefined && canonicalJson(previousId) !== canonicalJson(artifact)) {
      issues.push(issue(path, "unique", `artifact identifier '${artifact.artifactId}' has conflicting metadata`));
    }
    const previousPath = byPath.get(artifact.path);
    if (previousPath !== undefined && previousPath.sha256 !== artifact.sha256) {
      issues.push(issue(path, "collision", `artifact path '${artifact.path}' has conflicting checksums`));
    }
    byId.set(artifact.artifactId, artifact);
    byPath.set(artifact.path, artifact);
  });
  if (issues.length > 0) {
    throw new EvidenceError(target, issues);
  }
  return [...byId.values()].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
}

function visitValues(
  value: unknown,
  visitor: (value: unknown, path: string) => void,
  path = "",
): void {
  visitor(value, path || "/");
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      visitValues(item, visitor, `${path}/${index}`);
    }
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      visitValues(item, visitor, `${path}/${key}`);
    }
  }
}

function resultIdentifiers(
  document: Record<string, unknown>,
  key: string,
  collectionKey = "results",
): Set<string> {
  const identifiers = new Set<string>();
  const values = document[collectionKey];
  if (!Array.isArray(values)) {
    return identifiers;
  }
  for (const value of values) {
    if (!isRecord(value)) {
      continue;
    }
    const identifier = value[key];
    if (typeof identifier === "string") {
      identifiers.add(identifier);
    }
  }
  return identifiers;
}

function changedContentPaths(
  previousEntries: readonly ChecksumEntry[],
  currentEntries: readonly ChecksumEntry[],
): string[] {
  const previous = new Map(
    previousEntries
      .filter((entry) => entry.kind === "bundle-file" || entry.kind === "external-artifact")
      .map((entry) => [entry.path, entry.sha256] as const),
  );
  const current = new Map(currentEntries.map((entry) => [entry.path, entry.sha256] as const));
  const paths = new Set([...previous.keys(), ...current.keys()]);
  return [...paths]
    .filter((path) => previous.get(path) !== current.get(path))
    .sort((left, right) => left.localeCompare(right));
}

function parseJsonLines(path: string): unknown[] {
  const text = readRequiredText(path);
  if (text.length === 0) {
    return [];
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const values: unknown[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) {
      throw new EvidenceError(path, [
        issue(`/${index + 1}`, "parse", "blank JSONL records are not allowed"),
      ]);
    }
    try {
      values.push(JSON.parse(line) as unknown);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new EvidenceError(path, [issue(`/${index + 1}`, "parse", message)]);
    }
  }
  return values;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readRequiredText(path)) as unknown;
  } catch (error) {
    if (error instanceof EvidenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new EvidenceError(path, [issue("/", "parse", message)]);
  }
}

function readRequiredText(path: string): string {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new EvidenceError(path, [issue("/", "missing", "required file does not exist")]);
  }
  return readFileSync(path, "utf8");
}

function normalizeText(value: string): string {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function listFiles(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(root, absolute));
    } else if (entry.isFile()) {
      files.push(relative(root, absolute).split(sep).join("/"));
    } else {
      files.push(relative(root, absolute).split(sep).join("/"));
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function snapshotFiles(directory: string): ReadonlyMap<string, Buffer> {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    throw new EvidenceError(directory, [issue("/", "missing", "previous bundle does not exist")]);
  }
  return new Map(listFiles(directory).map((path) => [path, readFileSync(join(directory, path))]));
}

function assertSnapshotUnchanged(
  directory: string,
  snapshot: ReadonlyMap<string, Buffer>,
): void {
  const currentPaths = listFiles(directory);
  if (currentPaths.length !== snapshot.size) {
    throw new EvidenceError(directory, [issue("/", "immutable", "superseded revision changed")]);
  }
  for (const path of currentPaths) {
    const prior = snapshot.get(path);
    if (prior === undefined || !prior.equals(readFileSync(join(directory, path)))) {
      throw new EvidenceError(directory, [
        issue(`/${path}`, "immutable", "superseded revision bytes changed"),
      ]);
    }
  }
}

function requiredString(document: Record<string, unknown>, key: string, target: string): string {
  const value = document[key];
  if (typeof value !== "string") {
    throw new EvidenceError(target, [issue(`/${key}`, "type", "must be a string")]);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
