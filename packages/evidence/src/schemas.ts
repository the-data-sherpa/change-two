import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";

import { EvidenceError, type ValidationIssue } from "./types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as FormatsPlugin;
const SCHEMA_BASE_ID = "https://change-two.dev/schemas/evidence/v1/";

export class EvidenceSchemas {
  readonly #validators = new Map<string, ValidateFunction>();

  constructor(schemaDirectory = findEvidenceSchemaDirectory()) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const filenames = readdirSync(schemaDirectory)
      .filter((filename) => filename.endsWith(".schema.json"))
      .sort();

    for (const filename of filenames) {
      const schema = JSON.parse(readFileSync(join(schemaDirectory, filename), "utf8")) as {
        readonly $id?: string;
      };
      ajv.addSchema(schema);
    }

    for (const filename of filenames) {
      const schemaType = filename.slice(0, -".schema.json".length);
      const validator = ajv.getSchema(`${SCHEMA_BASE_ID}${filename}`);
      if (validator === undefined) {
        throw new Error(`Evidence schema '${filename}' did not compile.`);
      }
      this.#validators.set(schemaType, validator);
    }
  }

  validate<T>(schemaType: string, value: unknown, target: string): T {
    const validator = this.#validators.get(schemaType);
    if (validator === undefined) {
      throw new EvidenceError(target, [
        issue("/schemaType", "enum", `uses unknown evidence schema '${schemaType}'`),
      ]);
    }
    if (!validator(value)) {
      throw new EvidenceError(target, normalizeAjvErrors(validator.errors));
    }
    return value as T;
  }
}

export function findEvidenceSchemaDirectory(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    const candidate = join(current, "schemas", "evidence", "v1");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Could not locate schemas/evidence/v1 from the current directory.");
    }
    current = parent;
  }
}

export function issue(path: string, keyword: string, message: string): ValidationIssue {
  return { keyword, message, path };
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
