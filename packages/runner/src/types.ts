export type HarnessKind = "claude-code" | "codex" | "synthetic";
export type MeasurementMode = "enforced" | "estimated" | "observed-after-run" | "unavailable";
export type InterventionCategory =
  | "unavailable-information"
  | "independent-infrastructure-failure"
  | "safety-stop"
  | "plan-challenge"
  | "missed-requirement"
  | "investigation-request"
  | "test-request"
  | "patch-rejection"
  | "explanation-request";

export interface RunPlan {
  readonly schemaVersion: "runner/v1";
  readonly runId: string;
  readonly sourceRepository: string;
  readonly startingCommit: string;
  readonly requirementPath: string;
  readonly visibleVerification: {
    readonly publicRoot: string;
    readonly checkBundlePath: string;
  };
  readonly harness: {
    readonly kind: HarnessKind;
    readonly version: string;
    readonly model: string;
    readonly tools: readonly string[];
    readonly permissions: readonly string[];
    readonly syntheticCommand?: readonly string[];
  };
  readonly administrationPath?: string;
  readonly policy: {
    readonly mode: "minimal" | "active-review" | "human-baseline";
    readonly allowedInterventions: readonly InterventionCategory[];
  };
  readonly budget: {
    readonly wallClockSeconds: number;
    readonly operatorActiveSeconds: number;
    readonly reviewerActiveSeconds: number;
    readonly recoveryAttempts: number;
    readonly modelSpend: { readonly currency: string; readonly maximum: number; readonly measurementMode: MeasurementMode };
  };
  readonly container: {
    readonly image: string;
    readonly network:
      | { readonly mode: "none" }
      | { readonly mode: "controlled"; readonly allowedHosts: readonly string[] };
    readonly cpus: number;
    readonly memory: string;
    readonly environment: Readonly<Record<string, string>>;
    readonly credentialEnvironment: readonly string[];
    readonly credentialMounts?: readonly {
      readonly sourceEnvironment: string;
      readonly target: string;
    }[];
  };
}

export type VerificationCheckStatus = "passed" | "failed" | "error";

export interface VerificationCheckResult {
  readonly checkId: string;
  readonly status: VerificationCheckStatus;
  readonly diagnostics: readonly string[];
  readonly evidence: readonly unknown[];
}

export interface VerificationReport {
  readonly schemaVersion: "verification-report/v1";
  readonly passed: boolean;
  readonly error: {
    readonly category: "integrity" | "setup" | "bundle" | "application";
    readonly diagnostic: string;
  } | null;
  readonly checks: readonly VerificationCheckResult[];
}

export interface HarnessInvocation {
  readonly command: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly sourceName: string;
}

export interface HarnessAdapter {
  readonly kind: HarnessKind;
  createInvocation(plan: RunPlan, promptPath: string): HarnessInvocation;
  normalizeLine(stream: "stdout" | "stderr", line: string): { readonly eventType: string; readonly payload: unknown; readonly providerFields: Readonly<Record<string, unknown>> | null };
}

export type TerminationCause = "success" | "lineage-failure" | "adapter-failure" | "verification-exhausted" | "wall-clock-budget" | "manual-budget-stop";

export interface RunResult {
  readonly runId: string;
  readonly startingCommit: string;
  readonly submittedCommit: string;
  readonly workingTreeDirty: boolean;
  readonly terminationCause: TerminationCause;
  readonly recoveryAttemptsUsed: number;
  readonly budgetMeasurements: {
    readonly wallClock: { readonly mode: "enforced"; readonly seconds: number };
    readonly operatorActive: { readonly mode: "enforced"; readonly seconds: number };
    readonly reviewerActive: { readonly mode: "enforced"; readonly seconds: number };
    readonly modelSpend: { readonly mode: MeasurementMode; readonly amount: number | null; readonly currency: string };
  };
  readonly submission: { readonly patchPath: string; readonly sha256: string };
}

export class RunnerError extends Error {
  constructor(readonly category: "input" | "infrastructure" | "adapter" | "policy", message: string) {
    super(message);
    this.name = "RunnerError";
  }
}
