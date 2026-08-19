#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  approvePublication,
  readSanitizationPolicy,
  recordRetention,
  sanitizeBundle,
  scanBundle,
  writeSanitizationScan,
} from "./sanitizer.js";
import { SanitizationError, type ApprovalRequest, type RetentionRequest, type SanitizeRequest } from "./types.js";

const root = findRepositoryRoot();
const [command, ...arguments_] = process.argv.slice(2);
try {
  if (command === "scan") {
    requireArguments(arguments_, 3);
    const scan = scanBundle(resolve(root, arguments_[0] as string), readSanitizationPolicy(resolve(root, arguments_[1] as string)));
    writeSanitizationScan(resolve(root, arguments_[2] as string), scan);
    console.log(`${scan.status === "quarantined" ? "QUARANTINED" : "SCANNED"} ${scan.scanId} ${scan.findings.length}`);
    if (scan.status === "quarantined") process.exitCode = 1;
  } else if (command === "sanitize") {
    requireArguments(arguments_, 4);
    const report = sanitizeBundle(resolve(root, arguments_[0] as string), resolve(root, arguments_[1] as string), readSanitizationPolicy(resolve(root, arguments_[2] as string)), readJson(resolve(root, arguments_[3] as string)) as SanitizeRequest);
    console.log(`SANITIZED ${report.reportId} ${report.sanitizedBundle.contentSetSha256}`);
  } else if (command === "approve") {
    requireArguments(arguments_, 2);
    const approval = approvePublication(resolve(root, arguments_[0] as string), readJson(resolve(root, arguments_[1] as string)) as ApprovalRequest);
    console.log(`APPROVED ${approval.approvalId} ${approval.evidenceClass} ${approval.sanitizedContentSetSha256}`);
  } else if (command === "retention") {
    requireArguments(arguments_, 3);
    const record = recordRetention(resolve(root, arguments_[0] as string), resolve(root, arguments_[1] as string), readJson(resolve(root, arguments_[2] as string)) as RetentionRequest);
    console.log(`RETENTION ${record.events.at(-1)?.eventType ?? "unknown"} ${record.events.at(-1)?.eventId ?? "unknown"}`);
  } else {
    usage(); process.exitCode = 2;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`INVALID sanitizer command\n- / [error] ${message}`);
  if (error instanceof SanitizationError) for (const finding of error.findings) console.error(`- ${finding.path} [${finding.rule}] ${finding.reason}`);
  process.exitCode = 1;
}

function requireArguments(values: readonly string[], count: number): void { if (values.length !== count) { usage(); throw new SanitizationError(`Expected ${count} arguments.`); } }
function readJson(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")) as unknown; }
function findRepositoryRoot(): string { let current = process.cwd(); while (true) { if (readdirSync(current).includes("pnpm-workspace.yaml")) return current; const parent = resolve(current, ".."); if (parent === current) throw new Error("Could not locate repository root."); current = parent; } }
function usage(): void {
  console.error("Usage:");
  console.error("  ./change-two sanitizer scan <bundle-dir> <policy.json> <scan.json>");
  console.error("  ./change-two sanitizer sanitize <bundle-dir> <publication-dir> <policy.json> <request.json>");
  console.error("  ./change-two sanitizer approve <publication-dir> <approval.json>");
  console.error("  ./change-two sanitizer retention <publication-dir> <source-bundle-dir> <event.json>");
}
