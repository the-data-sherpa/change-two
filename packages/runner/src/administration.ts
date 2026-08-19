import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

import { RunnerError, type InterventionCategory, type RunPlan } from "./types.js";

export interface TimerInterval {
  readonly recordType: "timer-start" | "timer-stop" | "timer-correction";
  readonly intervalId: string;
  readonly actor: string;
  readonly role: "operator" | "reviewer";
  readonly monotonicNanoseconds: string;
  readonly timestamp: string;
  readonly correctionSeconds?: number;
  readonly reason?: string;
}

export interface InterventionRecord {
  readonly recordType: "intervention";
  readonly interventionId: string;
  readonly actor: string;
  readonly category: InterventionCategory | "manual-budget-stop";
  readonly text: string;
  readonly policyJustification: string | null;
  readonly timestamp: string;
}

export function startTimer(path: string, actor: string, role: TimerInterval["role"]): TimerInterval {
  const open = records(path).findLast((record): record is TimerInterval => record.recordType === "timer-start" && !hasStop(path, record.intervalId));
  if (open !== undefined) throw new RunnerError("policy", `Timer ${open.intervalId} is already active.`);
  const record: TimerInterval = { recordType: "timer-start", intervalId: `timer:${randomUUID()}`, actor, role, monotonicNanoseconds: process.hrtime.bigint().toString(), timestamp: new Date().toISOString() };
  append(path, record);
  return record;
}

export function stopTimer(path: string, intervalId: string, actor: string): TimerInterval {
  const start = records(path).find((record): record is TimerInterval => record.recordType === "timer-start" && record.intervalId === intervalId);
  if (start === undefined) throw new RunnerError("policy", `Unknown timer: ${intervalId}`);
  if (hasStop(path, intervalId)) throw new RunnerError("policy", `Timer is already stopped: ${intervalId}`);
  const record: TimerInterval = { recordType: "timer-stop", intervalId, actor, role: start.role, monotonicNanoseconds: process.hrtime.bigint().toString(), timestamp: new Date().toISOString() };
  append(path, record);
  return record;
}

export function correctTimer(path: string, intervalId: string, actor: string, seconds: number, reason: string): TimerInterval {
  if (!records(path).some((record) => "intervalId" in record && record.intervalId === intervalId)) throw new RunnerError("policy", `Unknown timer: ${intervalId}`);
  if (!Number.isFinite(seconds) || seconds < 0 || reason.length === 0) throw new RunnerError("input", "Timer correction requires non-negative seconds and a reason.");
  const record: TimerInterval = { recordType: "timer-correction", intervalId, actor, role: "operator", monotonicNanoseconds: process.hrtime.bigint().toString(), timestamp: new Date().toISOString(), correctionSeconds: seconds, reason };
  append(path, record);
  return record;
}

export function recordIntervention(path: string, plan: RunPlan, actor: string, category: InterventionRecord["category"], text: string, justification: string | null): InterventionRecord {
  if (text.length === 0) throw new RunnerError("input", "Intervention text cannot be empty.");
  if (category !== "manual-budget-stop" && !plan.policy.allowedInterventions.includes(category)) throw new RunnerError("policy", `Intervention category is not allowed: ${category}`);
  if (plan.policy.mode === "minimal" && (justification === null || justification.length === 0)) throw new RunnerError("policy", "Minimal-policy interventions require a justification.");
  const record: InterventionRecord = { recordType: "intervention", interventionId: `intervention:${randomUUID()}`, actor, category, text, policyJustification: justification, timestamp: new Date().toISOString() };
  append(path, record);
  return record;
}

export function activeSeconds(path: string, role: TimerInterval["role"]): number {
  const all = records(path);
  let total = 0;
  for (const start of all.filter((record): record is TimerInterval => record.recordType === "timer-start" && record.role === role)) {
    const correction = all.findLast((record): record is TimerInterval => record.recordType === "timer-correction" && record.intervalId === start.intervalId);
    if (correction?.correctionSeconds !== undefined) { total += correction.correctionSeconds; continue; }
    const stop = all.find((record): record is TimerInterval => record.recordType === "timer-stop" && record.intervalId === start.intervalId);
    if (stop !== undefined) total += Number(BigInt(stop.monotonicNanoseconds) - BigInt(start.monotonicNanoseconds)) / 1e9;
  }
  return total;
}

function records(path: string): readonly (TimerInterval | InterventionRecord)[] {
  try { return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as TimerInterval | InterventionRecord); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export function administrationRecords(path: string): readonly (TimerInterval | InterventionRecord)[] {
  return records(path);
}


function hasStop(path: string, intervalId: string): boolean {
  return records(path).some((record) => record.recordType === "timer-stop" && record.intervalId === intervalId);
}

function append(path: string, record: TimerInterval | InterventionRecord): void {
  appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}
