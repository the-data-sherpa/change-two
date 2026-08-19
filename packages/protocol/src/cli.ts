#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { ProtocolValidator, type ValidationResult } from "./validator.js";

const repositoryRoot = findRepositoryRoot();
const validator = new ProtocolValidator();
const [command, ...arguments_] = process.argv.slice(2);

switch (command) {
  case "validate":
    requireArgumentCount(arguments_, 1);
    process.exitCode = validateFile(
      resolve(repositoryRoot, arguments_[0] as string),
      undefined,
    );
    break;
  case "validate-matrix":
    requireArgumentCount(arguments_, 1);
    process.exitCode = validateFile(
      resolve(repositoryRoot, arguments_[0] as string),
      "evaluation-matrix",
    );
    break;
  case "check-fixtures":
    requireArgumentCount(arguments_, 0);
    process.exitCode = checkFixtures();
    break;
  default:
    printUsage();
    process.exitCode = 2;
}

function validateFile(path: string, expectedSchemaType: string | undefined): number {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`INVALID ${path}`);
    console.error(`- / [parse] ${message}`);
    return 1;
  }

  const result = validator.validate(document);
  if (
    result.valid &&
    expectedSchemaType !== undefined &&
    result.schemaType !== expectedSchemaType
  ) {
    console.error(`INVALID ${path}`);
    console.error(
      `- /schemaType [const] must be '${expectedSchemaType}', received '${result.schemaType}'`,
    );
    return 1;
  }

  if (!result.valid) {
    printIssues(path, result);
    return 1;
  }

  console.log(`VALID ${result.schemaType} ${path}`);
  return 0;
}

function checkFixtures(): number {
  const fixtureRoot = join(repositoryRoot, "fixtures", "protocol");
  const validPaths = jsonFiles(join(fixtureRoot, "valid"));
  const invalidPaths = jsonFiles(join(fixtureRoot, "invalid"));
  let failures = 0;

  for (const path of validPaths) {
    const result = validateFixture(path);
    if (!result.valid) {
      console.error(`Expected valid fixture to pass: ${basename(path)}`);
      printIssues(path, result);
      failures += 1;
    }
  }

  for (const path of invalidPaths) {
    const result = validateFixture(path);
    if (result.valid) {
      console.error(`Expected invalid fixture to fail: ${basename(path)}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`Fixture validation failed with ${failures} unexpected result(s).`);
    return 1;
  }

  console.log(
    `Fixture validation passed: ${validPaths.length} valid and ${invalidPaths.length} invalid fixture(s).`,
  );
  return 0;
}

function validateFixture(path: string): ValidationResult {
  try {
    return validator.validate(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch (error) {
    return {
      issues: [
        {
          keyword: "parse",
          message: error instanceof Error ? error.message : String(error),
          path: "/",
        },
      ],
      schemaType: undefined,
      valid: false,
    };
  }
}

function printIssues(path: string, result: Extract<ValidationResult, { valid: false }>): void {
  console.error(`INVALID ${path}`);
  for (const issue of result.issues) {
    console.error(`- ${issue.path || "/"} [${issue.keyword}] ${issue.message}`);
  }
}

function jsonFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((filename) => filename.endsWith(".json"))
    .sort()
    .map((filename) => join(directory, filename));
}

function findRepositoryRoot(): string {
  let current = process.cwd();
  while (true) {
    if (readdirSync(current).includes("pnpm-workspace.yaml")) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      throw new Error("Could not locate the repository root.");
    }
    current = parent;
  }
}

function requireArgumentCount(arguments_: readonly string[], expected: number): void {
  if (arguments_.length !== expected) {
    printUsage();
    process.exit(2);
  }
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  ./change-two protocol validate <document.json>");
  console.error("  ./change-two protocol validate-matrix <matrix.json>");
  console.error("  ./change-two protocol check-fixtures");
}
