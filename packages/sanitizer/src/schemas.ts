import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";

import { SanitizationError } from "./types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as FormatsPlugin;

const SCHEMA_FILES = {
  policy: "sanitization-policy.schema.json",
  scan: "sanitization-scan.schema.json",
  report: "sanitization-report.schema.json",
  approval: "publication-approval.schema.json",
  retention: "retention-record.schema.json",
} as const;

export type SanitizerSchemaName = keyof typeof SCHEMA_FILES;

export class SanitizerSchemas {
  readonly #validators = new Map<SanitizerSchemaName, ValidateFunction>();

  constructor() {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const schemaDirectory = locateSchemaDirectory();
    for (const [name, file] of Object.entries(SCHEMA_FILES) as [SanitizerSchemaName, string][]) {
      const schema = JSON.parse(readFileSync(resolve(schemaDirectory, file), "utf8")) as object;
      this.#validators.set(name, ajv.compile(schema));
    }
  }

  validate<T>(name: SanitizerSchemaName, value: unknown, target: string = name): T {
    const validator = this.#validators.get(name);
    if (validator === undefined || !validator(value)) {
      const errors = validator?.errors ?? [];
      throw new SanitizationError(`Invalid ${target}: ${formatErrors(errors)}`);
    }
    return value as T;
  }
}

function locateSchemaDirectory(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(moduleDirectory, "../schemas"), resolve(moduleDirectory, "../../schemas")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new SanitizationError("Could not locate sanitizer schemas.");
  }
  return found;
}

function formatErrors(errors: readonly ErrorObject[]): string {
  if (errors.length === 0) {
    return "schema validation failed";
  }
  return errors
    .map((error) => `${error.instancePath || "/"} [${error.keyword}] ${error.message ?? "invalid"}`)
    .join("; ");
}
