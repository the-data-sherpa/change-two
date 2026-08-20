import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import type {
  ErrorObject,
  ValidateFunction,
} from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as FormatsPlugin;

const SCHEMA_BASE_ID = "https://change-two.dev/schemas/protocol/v1/";
const PLACEHOLDER = /^(?:tbd|todo|unknown|unset)$/i;

export interface ValidationIssue {
  readonly keyword: string;
  readonly message: string;
  readonly path: string;
}

export type ValidationResult =
  | { readonly valid: true; readonly schemaType: string }
  | {
      readonly issues: readonly ValidationIssue[];
      readonly schemaType: string | undefined;
      readonly valid: false;
    };

interface ProtocolDocument {
  readonly schemaType?: unknown;
  readonly [key: string]: unknown;
}

interface MatrixCriterion {
  readonly criterionId: string;
  readonly severityBlocking: boolean;
}

interface MatrixCheck {
  readonly checkId: string;
  readonly method: "behavioral" | "structural";
  readonly covers: {
    readonly criterionIds: readonly string[];
    readonly invariantIds: readonly string[];
  };
}

interface MatrixInvariant {
  readonly invariantId: string;
  readonly severityBlocking: boolean;
}

interface EvaluationMatrix extends ProtocolDocument {
  readonly checks: readonly MatrixCheck[];
  readonly criteria: readonly MatrixCriterion[];
  readonly invariants: readonly MatrixInvariant[];
  readonly schemaType: "evaluation-matrix";
}

export class ProtocolValidator {
  readonly #validators = new Map<string, ValidateFunction>();

  constructor(schemaDirectory = findProtocolSchemaDirectory()) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);

    for (const filename of readdirSync(schemaDirectory).sort()) {
      if (!filename.endsWith(".schema.json")) {
        continue;
      }
      const schema = JSON.parse(
        readFileSync(join(schemaDirectory, filename), "utf8"),
      ) as { readonly $id?: string };
      ajv.addSchema(schema);
    }

    for (const filename of readdirSync(schemaDirectory).sort()) {
      if (filename === "common.schema.json" || !filename.endsWith(".schema.json")) {
        continue;
      }
      const schemaType = filename.slice(0, -".schema.json".length);
      const validator = ajv.getSchema(`${SCHEMA_BASE_ID}${filename}`);
      if (validator === undefined) {
        throw new Error(`Schema '${filename}' did not compile.`);
      }
      this.#validators.set(schemaType, validator);
    }
  }

  validate(document: unknown): ValidationResult {
    if (!isProtocolDocument(document)) {
      return invalid(undefined, "", "type", "must be a JSON object");
    }

    const schemaType =
      typeof document.schemaType === "string" ? document.schemaType : undefined;
    if (schemaType === undefined) {
      return invalid(undefined, "/schemaType", "required", "must identify a schema type");
    }

    const validator = this.#validators.get(schemaType);
    if (validator === undefined) {
      return invalid(
        schemaType,
        "/schemaType",
        "enum",
        `uses unknown schema type '${schemaType}'`,
      );
    }

    if (!validator(document)) {
      return {
        issues: normalizeAjvErrors(validator.errors),
        schemaType,
        valid: false,
      };
    }

    const issues = this.#validateSemantics(document, schemaType);
    return issues.length === 0
      ? { schemaType, valid: true }
      : { issues, schemaType, valid: false };
  }

  #validateSemantics(
    document: ProtocolDocument,
    schemaType: string,
  ): ValidationIssue[] {
    if (schemaType === "evaluation-matrix") {
      return validateMatrix(document as EvaluationMatrix);
    }
    if (schemaType === "season-manifest") {
      return [
        ...findPlaceholders(document),
        ...validateSeasonReferences(document),
      ];
    }
    if (schemaType === "round") {
      return validateRoundOrder(document);
    }
    if (schemaType === "run-manifest") {
      return validateRunTimes(document);
    }
    return [];
  }
}

export function findProtocolSchemaDirectory(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    const candidate = join(current, "schemas", "protocol", "v1");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Could not locate schemas/protocol/v1 from the current directory.");
    }
    current = parent;
  }
}

function isProtocolDocument(value: unknown): value is ProtocolDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(
  schemaType: string | undefined,
  path: string,
  keyword: string,
  message: string,
): ValidationResult {
  return { issues: [{ keyword, message, path }], schemaType, valid: false };
}

function normalizeAjvErrors(
  errors: readonly ErrorObject[] | null | undefined,
): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    keyword: error.keyword,
    message: error.message ?? "is invalid",
    path: error.instancePath || "/",
  }));
}

function validateMatrix(matrix: EvaluationMatrix): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const criteria = indexUnique(
    matrix.criteria,
    "criterionId",
    "/criteria",
    issues,
  );
  const invariants = indexUnique(
    matrix.invariants,
    "invariantId",
    "/invariants",
    issues,
  );
  indexUnique(matrix.checks, "checkId", "/checks", issues);

  const coveredCriteria = new Set<string>();
  const behavioralCoverage = new Set<string>();

  for (const [index, check] of matrix.checks.entries()) {
    const checkPath = `/checks/${index}/covers`;
    if (
      check.covers.criterionIds.length === 0 &&
      check.covers.invariantIds.length === 0
    ) {
      issues.push(issue(checkPath, "orphan", "must cover a Criterion or invariant"));
    }

    for (const criterionId of check.covers.criterionIds) {
      if (!criteria.has(criterionId)) {
        issues.push(
          issue(
            `${checkPath}/criterionIds`,
            "reference",
            `references unknown Criterion '${criterionId}'`,
          ),
        );
        continue;
      }
      coveredCriteria.add(criterionId);
      if (check.method === "behavioral") {
        behavioralCoverage.add(criterionId);
      }
    }

    for (const invariantId of check.covers.invariantIds) {
      if (!invariants.has(invariantId)) {
        issues.push(
          issue(
            `${checkPath}/invariantIds`,
            "reference",
            `references unknown invariant '${invariantId}'`,
          ),
        );
        continue;
      }
      if (check.method === "behavioral") {
        behavioralCoverage.add(invariantId);
      }
    }
  }

  for (const criterion of matrix.criteria) {
    if (!coveredCriteria.has(criterion.criterionId)) {
      issues.push(
        issue(
          "/criteria",
          "coverage",
          `Criterion '${criterion.criterionId}' has no Check`,
        ),
      );
    }
    if (
      criterion.severityBlocking &&
      !behavioralCoverage.has(criterion.criterionId)
    ) {
      issues.push(
        issue(
          "/criteria",
          "behavioral-coverage",
          `severity-blocking Criterion '${criterion.criterionId}' requires a behavioral Check`,
        ),
      );
    }
  }

  for (const invariant of matrix.invariants) {
    if (
      invariant.severityBlocking &&
      !behavioralCoverage.has(invariant.invariantId)
    ) {
      issues.push(
        issue(
          "/invariants",
          "behavioral-coverage",
          `severity-blocking invariant '${invariant.invariantId}' requires a behavioral Check`,
        ),
      );
    }
  }


  return issues;
}

function indexUnique<T extends object, K extends keyof T>(
  values: readonly T[],
  key: K,
  path: string,
  issues: ValidationIssue[],
): Map<T[K], T> {
  const indexed = new Map<T[K], T>();
  for (const [index, value] of values.entries()) {
    const id = value[key];
    if (indexed.has(id)) {
      issues.push(
        issue(`${path}/${index}/${String(key)}`, "unique", `duplicates '${String(id)}'`),
      );
    } else {
      indexed.set(id, value);
    }
  }
  return indexed;
}

function findPlaceholders(value: unknown, path = ""): ValidationIssue[] {
  if (typeof value === "string") {
    return PLACEHOLDER.test(value)
      ? [issue(path || "/", "placeholder", "must not contain an unresolved value")]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findPlaceholders(item, `${path}/${index}`));
  }
  if (isProtocolDocument(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      findPlaceholders(item, `${path}/${escapePointer(key)}`),
    );
  }
  return [];
}

function validateSeasonReferences(document: ProtocolDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const policies = indexDocuments(
    document.policies,
    "policyId",
    "/policies",
    "Policy",
    issues,
  );
  const budgets = indexDocuments(
    document.budgets,
    "budgetId",
    "/budgets",
    "Budget",
    issues,
  );
  const lineages = indexDocuments(
    document.lineages,
    "lineageId",
    "/lineages",
    "Lineage",
    issues,
  );
  const harnesses = indexDocuments(
    document.harnesses,
    "harnessId",
    "/harnesses",
    "harness",
    issues,
  );
  indexDocuments(
    document.sealedArtifacts,
    "artifactId",
    "/sealedArtifacts",
    "artifact",
    issues,
  );

  const lineageValues = Array.isArray(document.lineages)
    ? document.lineages
    : [];
  const roles = isProtocolDocument(document.roles) ? document.roles : {};
  const builderIds = new Set(Array.isArray(roles.builderIds) ? roles.builderIds : []);
  const operatorIds = new Set(Array.isArray(roles.operatorIds) ? roles.operatorIds : []);
  for (const role of ["independentReviewerId", "blindedReviewerId"] as const) {
    const reviewerId = roles[role];
    if (builderIds.has(reviewerId) || operatorIds.has(reviewerId)) {
      issues.push(
        issue(
          `/roles/${role}`,
          "separation",
          `${String(reviewerId)} must not also be a builder or operator`,
        ),
      );
    }
  }
  for (const [index, lineage] of lineageValues.entries()) {
    if (!isProtocolDocument(lineage)) continue;
    validateVersionedReference(
      lineage.policyRef,
      policies,
      `/lineages/${index}/policyRef`,
      "Policy",
      issues,
    );
    validateVersionedReference(
      lineage.budgetRef,
      budgets,
      `/lineages/${index}/budgetRef`,
      "Budget",
      issues,
    );
    validateIdReference(
      lineage.builderId,
      builderIds,
      `/lineages/${index}/builderId`,
      "builder",
      issues,
    );
    if (lineage.workflow === "agent") {
      validateIdReference(
        lineage.harnessId,
        new Set(harnesses.keys()),
        `/lineages/${index}/harnessId`,
        "harness",
        issues,
      );
    }
  }

  const executionRounds = isProtocolDocument(document.executionOrder)
    ? document.executionOrder.rounds
    : undefined;
  if (Array.isArray(executionRounds)) {
    const seenChangeIds = new Set<unknown>();
    for (const [index, round] of executionRounds.entries()) {
      if (!isProtocolDocument(round)) continue;
      if (seenChangeIds.has(round.changeId)) {
        issues.push(
          issue(
            `/executionOrder/rounds/${index}/changeId`,
            "unique",
            `duplicates Change '${String(round.changeId)}'`,
          ),
        );
      }
      seenChangeIds.add(round.changeId);
      if (Array.isArray(round.lineageIds)) {
        validateSameIds(
          round.lineageIds,
          new Set(lineages.keys()),
          `/executionOrder/rounds/${index}/lineageIds`,
          "Lineage",
          issues,
        );
      }
    }
  }
  return issues;
}

function validateRoundOrder(document: ProtocolDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lineageIds = Array.isArray(document.lineageIds) ? document.lineageIds : [];
  const runOrder = Array.isArray(document.runOrder) ? document.runOrder : [];
  validateSameIds(runOrder, new Set(lineageIds), "/runOrder", "Lineage", issues);
  return issues;
}

function validateRunTimes(document: ProtocolDocument): ValidationIssue[] {
  if (
    typeof document.startedAt === "string" &&
    typeof document.endedAt === "string" &&
    Date.parse(document.endedAt) < Date.parse(document.startedAt)
  ) {
    return [issue("/endedAt", "order", "must not precede startedAt")];
  }
  return [];
}

function indexDocuments(
  value: unknown,
  key: string,
  path: string,
  label: string,
  issues: ValidationIssue[],
): Map<unknown, ProtocolDocument> {
  const indexed = new Map<unknown, ProtocolDocument>();
  if (!Array.isArray(value)) return indexed;

  for (const [index, document] of value.entries()) {
    if (!isProtocolDocument(document)) continue;
    const id = document[key];
    if (indexed.has(id)) {
      issues.push(
        issue(
          `${path}/${index}/${key}`,
          "unique",
          `duplicates ${label} '${String(id)}'`,
        ),
      );
    } else {
      indexed.set(id, document);
    }
  }
  return indexed;
}

function validateVersionedReference(
  value: unknown,
  known: Map<unknown, ProtocolDocument>,
  path: string,
  label: string,
  issues: ValidationIssue[],
): void {
  if (!isProtocolDocument(value)) return;

  const referenced = known.get(value.id);
  if (referenced === undefined) {
    issues.push(
      issue(
        `${path}/id`,
        "reference",
        `references unknown ${label} '${String(value.id)}'`,
      ),
    );
  } else if (value.version !== referenced.version) {
    issues.push(
      issue(
        `${path}/version`,
        "reference",
        `does not match ${label} '${String(value.id)}' version '${String(referenced.version)}'`,
      ),
    );
  }
}

function validateIdReference(
  value: unknown,
  known: ReadonlySet<unknown>,
  path: string,
  label: string,
  issues: ValidationIssue[],
): void {
  if (!known.has(value)) {
    issues.push(
      issue(path, "reference", `references unknown ${label} '${String(value)}'`),
    );
  }
}

function validateSameIds(
  actual: readonly unknown[],
  expected: Set<unknown>,
  path: string,
  label: string,
  issues: ValidationIssue[],
): void {
  const actualIds = new Set(actual);
  for (const id of expected) {
    if (!actualIds.has(id)) {
      issues.push(issue(path, "coverage", `omits ${label} '${String(id)}'`));
    }
  }
  for (const id of actualIds) {
    if (!expected.has(id)) {
      issues.push(issue(path, "reference", `contains unknown ${label} '${String(id)}'`));
    }
  }
}

function issue(path: string, keyword: string, message: string): ValidationIssue {
  return { keyword, message, path };
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
