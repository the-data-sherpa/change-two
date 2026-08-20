import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const bundleDirectory = realpathSync("/check-bundle");
const outputPath = process.argv[2] ?? "/verification-report.json";
let manifest;

try {
  manifest = loadManifest(bundleDirectory);
  const entrypoint = realpathSync(resolve(bundleDirectory, manifest.entrypoint));
  if (!entrypoint.startsWith(`${bundleDirectory}${sep}`)) throw new Error("Bundle entrypoint escapes the Check bundle directory.");
  const module = await import(pathToFileURL(entrypoint).href);
  if (typeof module.default !== "function") throw new Error("Bundle entrypoint must export a default function.");
  const values = await module.default(Object.freeze({
    apiBaseUrl: "http://submission:3000",
    webBaseUrl: "http://submission:4173",
    chromium,
  }));
  const checks = normalizeResults(manifest, values);
  const report = {
    schemaVersion: "verification-report/v1",
    passed: checks.every((check) => check.status === "passed"),
    error: null,
    checks,
  };
  writeReport(outputPath, report);
  process.exitCode = report.passed ? 0 : 1;
} catch (error) {
  const diagnostic = error instanceof Error ? error.message : String(error);
  const checks = Array.isArray(manifest?.checks)
    ? manifest.checks.map(({ checkId }) => ({ checkId, status: "error", diagnostics: [diagnostic], evidence: [] }))
    : [];
  writeReport(outputPath, {
    schemaVersion: "verification-report/v1",
    passed: false,
    error: { category: "bundle", diagnostic },
    checks,
  });
  process.exitCode = 2;
}

function loadManifest(directory) {
  const value = JSON.parse(readFileSync(resolve(directory, "bundle.json"), "utf8"));
  if (value?.schemaVersion !== "verification-bundle/v1") throw new Error("Unsupported Check bundle schemaVersion.");
  if (typeof value.entrypoint !== "string" || value.entrypoint.length === 0) throw new Error("Check bundle entrypoint is required.");
  if (!Array.isArray(value.checks) || value.checks.length === 0) throw new Error("Check bundle must declare at least one Check.");
  const identifiers = new Set();
  for (const check of value.checks) {
    if (typeof check?.checkId !== "string" || check.checkId.length === 0 || typeof check.title !== "string" || check.title.length === 0) {
      throw new Error("Every Check bundle entry requires checkId and title.");
    }
    if (identifiers.has(check.checkId)) throw new Error(`Duplicate Check identifier: ${check.checkId}.`);
    identifiers.add(check.checkId);
  }
  return value;
}

function normalizeResults(expected, values) {
  if (!Array.isArray(values)) throw new Error("Bundle entrypoint must return a Check result array.");
  const byIdentifier = new Map();
  for (const value of values) {
    if (typeof value?.checkId !== "string" || byIdentifier.has(value.checkId)) throw new Error("Bundle returned a missing or duplicate Check identifier.");
    byIdentifier.set(value.checkId, value);
  }
  if (byIdentifier.size !== expected.checks.length) throw new Error("Bundle did not return exactly its declared Checks.");
  return expected.checks.map(({ checkId }) => {
    const value = byIdentifier.get(checkId);
    if (value === undefined) throw new Error(`Bundle omitted ${checkId}.`);
    if (!["passed", "failed", "error"].includes(value.status)) throw new Error(`${checkId} returned an unsupported status.`);
    if (!Array.isArray(value.diagnostics) || !value.diagnostics.every((item) => typeof item === "string")) throw new Error(`${checkId} diagnostics must be strings.`);
    if (!Array.isArray(value.evidence)) throw new Error(`${checkId} evidence must be an array.`);
    return { checkId, status: value.status, diagnostics: value.diagnostics, evidence: value.evidence };
  });
}

function writeReport(path, report) {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}
