export const SANITIZATION_SCHEMA_VERSION = "sanitization/v1" as const;

export type FindingCategory =
  | "credential"
  | "authentication"
  | "private-path"
  | "unrelated-history"
  | "unreleased-content"
  | "ambiguous";
export type FindingDisposition = "redact" | "block" | "ambiguous";

export interface BundleIdentity {
  readonly revisionId: string;
  readonly contentSetSha256: string;
}

export interface SanitizationPolicy {
  readonly schemaType: "sanitization-policy";
  readonly schemaVersion: typeof SANITIZATION_SCHEMA_VERSION;
  readonly releaseId: string;
  readonly releasedChangeIds: readonly string[];
  readonly releasedHiddenCheckIds: readonly string[];
}

export interface PolicyIdentity {
  readonly releaseId: string;
  readonly sha256: string;
}

export interface SanitizationFinding {
  readonly findingId: string;
  readonly path: string;
  readonly rule: string;
  readonly category: FindingCategory;
  readonly disposition: FindingDisposition;
  readonly reason: string;
  readonly sourceSha256: string;
  readonly matchSha256: string;
}

export interface SanitizationScan {
  readonly schemaType: "sanitization-scan";
  readonly schemaVersion: typeof SANITIZATION_SCHEMA_VERSION;
  readonly scanId: string;
  readonly generatedAt: string;
  readonly sourceBundle: BundleIdentity;
  readonly policy: PolicyIdentity;
  readonly status: "clean" | "redactable" | "quarantined";
  readonly findings: readonly SanitizationFinding[];
}

export interface TransformationRecord {
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly sanitizedPath: string;
  readonly sanitizedSha256: string;
  readonly rule: string;
  readonly reason: string;
}
export interface AmbiguityResolution {
  readonly findingId: string;
  readonly decision: "not-sensitive";
  readonly reviewedAt: string;
  readonly reviewer: HumanActor;
  readonly reason: string;
}


export interface SanitizationReport {
  readonly schemaType: "sanitization-report";
  readonly schemaVersion: typeof SANITIZATION_SCHEMA_VERSION;
  readonly reportId: string;
  readonly generatedAt: string;
  readonly sourceBundle: BundleIdentity;
  readonly sanitizedBundle: BundleIdentity;
  readonly policy: PolicyIdentity;
  readonly status: "passed";
  readonly findings: readonly SanitizationFinding[];
  readonly ambiguityResolutions: readonly AmbiguityResolution[];
  readonly transformations: readonly TransformationRecord[];
  readonly blockers: readonly [];
  readonly ambiguities: readonly [];
}

export interface HumanActor {
  readonly kind: "human";
  readonly identifier: string;
}

export interface RetentionActor {
  readonly kind: "human" | "automation";
  readonly identifier: string;
}

export interface PublicationApproval {
  readonly schemaType: "publication-approval";
  readonly schemaVersion: typeof SANITIZATION_SCHEMA_VERSION;
  readonly approvalId: string;
  readonly reportId: string;
  readonly sanitizedContentSetSha256: string;
  readonly decision: "approved";
  readonly evidenceClass: "practice" | "measured";
  readonly immutableReleaseAssetUrl?: string | null;
  readonly approvedAt: string;
  readonly approver: HumanActor;
  readonly statement: string;
}

export interface RetentionEvent {
  readonly eventId: string;
  readonly eventType: "scheduled" | "hold-placed" | "hold-released" | "destroyed";
  readonly recordedAt: string;
  readonly actor: RetentionActor;
  readonly reason: string;
  readonly incidentReference?: string;
}

export interface RetentionRecord {
  readonly schemaType: "retention-record";
  readonly schemaVersion: typeof SANITIZATION_SCHEMA_VERSION;
  readonly sourceContentSetSha256: string;
  readonly publicationApprovedAt: string | null;
  readonly destructionDueAt: string | null;
  readonly events: readonly RetentionEvent[];
}

export interface ScanOptions {
  readonly generatedAt?: string;
}

export interface SanitizeRequest {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly ambiguityResolutions?: readonly AmbiguityResolution[];
}

export type ApprovalRequest = Omit<PublicationApproval, "schemaType" | "schemaVersion" | "reportId" | "sanitizedContentSetSha256" | "decision">;

export interface RetentionRequest {
  readonly eventId: string;
  readonly action: "hold" | "release-hold" | "destroy";
  readonly recordedAt: string;
  readonly actor: RetentionActor;
  readonly reason: string;
  readonly incidentReference?: string;
}

export interface PublicationEnvelope {
  readonly directory: string;
  readonly bundleDirectory: string;
  readonly report: SanitizationReport;
  readonly approval: PublicationApproval;
  readonly retention: RetentionRecord;
}

export class SanitizationError extends Error {
  readonly findings: readonly SanitizationFinding[];

  constructor(message: string, findings: readonly SanitizationFinding[] = []) {
    super(message);
    this.name = "SanitizationError";
    this.findings = findings;
  }
}
