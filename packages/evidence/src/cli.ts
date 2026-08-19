#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  createCorrection,
  materializeCapture,
  replayCapture,
  verifyBundle,
} from "./bundle.js";
import { EvidenceError } from "./types.js";

const repositoryRoot = findRepositoryRoot();
const [command, ...arguments_] = process.argv.slice(2);

try {
  switch (command) {
    case "materialize": {
      requireArgumentCount(arguments_, 2);
      const capture = resolve(repositoryRoot, arguments_[0] as string);
      const bundle = resolve(repositoryRoot, arguments_[1] as string);
      const result = materializeCapture(capture, bundle);
      console.log(`MATERIALIZED ${result.revisionId} ${result.contentSetSha256} ${result.bundleDirectory}`);
      break;
    }
    case "replay": {
      requireArgumentCount(arguments_, 2);
      const capture = resolve(repositoryRoot, arguments_[0] as string);
      const bundle = resolve(repositoryRoot, arguments_[1] as string);
      const result = replayCapture(capture, bundle);
      console.log(`REPLAYED ${result.revisionId} ${result.contentSetSha256} ${result.bundleDirectory}`);
      break;
    }
    case "verify": {
      requireArgumentCount(arguments_, 1);
      const bundle = resolve(repositoryRoot, arguments_[0] as string);
      const result = verifyBundle(bundle);
      console.log(`VALID evidence-bundle ${result.revisionId} ${result.contentSetSha256} ${result.bundleDirectory}`);
      break;
    }
    case "correct": {
      requireArgumentCount(arguments_, 4);
      const capture = resolve(repositoryRoot, arguments_[0] as string);
      const previousBundle = resolve(repositoryRoot, arguments_[1] as string);
      const newBundle = resolve(repositoryRoot, arguments_[2] as string);
      const request = resolve(repositoryRoot, arguments_[3] as string);
      const result = createCorrection(capture, previousBundle, newBundle, request);
      console.log(`CORRECTED ${result.revisionId} ${result.contentSetSha256} ${result.bundleDirectory}`);
      break;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
} catch (error) {
  if (error instanceof EvidenceError) {
    console.error(`INVALID ${error.target}`);
    for (const validationIssue of error.issues) {
      console.error(
        `- ${validationIssue.path || "/"} [${validationIssue.keyword}] ${validationIssue.message}`,
      );
    }
    process.exitCode = 1;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error("INVALID evidence command");
    console.error(`- / [error] ${message}`);
    process.exitCode = 1;
  }
}

function requireArgumentCount(arguments_: readonly string[], expected: number): void {
  if (arguments_.length !== expected) {
    printUsage();
    throw new EvidenceError("evidence command", [
      { keyword: "arguments", message: `expected ${expected} argument(s)`, path: "/" },
    ]);
  }
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

function printUsage(): void {
  console.error("Usage:");
  console.error("  ./change-two evidence materialize <capture.jsonl> <bundle-dir>");
  console.error("  ./change-two evidence replay <capture.jsonl> <bundle-dir>");
  console.error("  ./change-two evidence verify <bundle-dir>");
  console.error(
    "  ./change-two evidence correct <capture.jsonl> <previous-bundle-dir> <new-bundle-dir> <correction.json>",
  );
}
