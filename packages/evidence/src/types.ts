export const SCHEMA_VERSION = "evidence/v1" as const;

export interface EvidenceSource {
  readonly kind: "provider" | "harness" | "operator" | "evaluator" | "reviewer" | "repository";
  readonly name: string;
  readonly providerEventId: string | null;
  readonly providerFields: Readonly<Record<string, unknown>> | null;
}

export interface ArtifactReference {
  readonly schemaType: "artifact-reference";
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly artifactId: string;
  readonly path: string;
  readonly sha256: string;
  readonly mediaType: string;
  readonly source: EvidenceSource;
}

export interface CaptureEvent {
  readonly schemaType: "capture-event";
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly elapsedNanoseconds: number;
  readonly source: EvidenceSource;
  readonly eventType: string;
  readonly sanitization: "raw" | "quarantined" | "sanitized" | "approved";
  readonly payload?: unknown;
  readonly artifactReference?: ArtifactReference;
}

export interface ChecksumEntry {
  readonly path: string;
  readonly sha256: string;
  readonly kind: "bundle-file" | "external-artifact" | "revision" | "checksum-manifest";
  readonly mode: "bytes" | "self-canonical";
}

export interface ChecksumManifest {
  readonly schemaType: "checksums";
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly algorithm: "sha256";
  readonly contentSetSha256: string;
  readonly entries: readonly ChecksumEntry[];
}

export interface BundleRevision {
  readonly schemaType: "bundle-revision";
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly revisionId: string;
  readonly supersededRevisionId: string;
  readonly reason: string;
  readonly author: string;
  readonly timestamp: string;
  readonly supersededContentSetSha256: string;
  readonly currentContentSetSha256: string;
  readonly changedArtifacts: readonly string[];
}

export interface CorrectionRequest {
  readonly schemaType: "correction-request";
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly revisionId: string;
  readonly reason: string;
  readonly author: string;
  readonly timestamp: string;
}

export interface ValidationIssue {
  readonly keyword: string;
  readonly message: string;
  readonly path: string;
}

export class EvidenceError extends Error {
  readonly issues: readonly ValidationIssue[];
  readonly target: string;

  constructor(target: string, issues: readonly ValidationIssue[]) {
    super(`Evidence validation failed for ${target}.`);
    this.name = "EvidenceError";
    this.target = target;
    this.issues = issues;
  }
}
