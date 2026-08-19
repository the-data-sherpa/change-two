#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { correctTimer, recordIntervention, startTimer, stopTimer } from "./administration.js";
import { executeRun } from "./runner.js";
import { RunnerError, type InterventionCategory, type RunPlan } from "./types.js";

const [command, ...arguments_] = process.argv.slice(2);

try {
  switch (command) {
    case "execute": {
      requireCount(arguments_, 2);
      const plan = loadPlan(arguments_[0] as string);
      console.log(JSON.stringify(executeRun(plan, arguments_[1] as string)));
      break;
    }
    case "timer-start": {
      requireCount(arguments_, 3);
      console.log(JSON.stringify(startTimer(resolve(arguments_[0] as string), arguments_[1] as string, arguments_[2] as "operator" | "reviewer")));
      break;
    }
    case "timer-stop": {
      requireCount(arguments_, 3);
      console.log(JSON.stringify(stopTimer(resolve(arguments_[0] as string), arguments_[1] as string, arguments_[2] as string)));
      break;
    }
    case "timer-correct": {
      requireCount(arguments_, 5);
      console.log(JSON.stringify(correctTimer(resolve(arguments_[0] as string), arguments_[1] as string, arguments_[2] as string, Number(arguments_[3]), arguments_[4] as string)));
      break;
    }
    case "intervene": {
      if (arguments_.length !== 6) throw new RunnerError("input", "intervene requires 6 arguments.");
      const plan = loadPlan(arguments_[0] as string);
      const category = arguments_[3] as InterventionCategory | "manual-budget-stop";
      const record = recordIntervention(resolve(arguments_[1] as string), plan, arguments_[2] as string, category, arguments_[4] as string, (arguments_[5] as string) === "-" ? null : arguments_[5] as string);
      if (category === "manual-budget-stop") {
        const containerName = `change-two-${plan.runId.replace(/[^a-zA-Z0-9_.-]/g, "-")}`;
        spawnSync("docker", ["stop", "--time", "1", containerName], { encoding: "utf8" });
      }
      console.log(JSON.stringify(record));
      break;
    }
    default:
      usage();
      process.exitCode = 2;
  }
} catch (error) {
  const category = error instanceof RunnerError ? error.category : "internal";
  console.error(`INVALID runner ${category}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function loadPlan(path: string): RunPlan {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as RunPlan;
}

function requireCount(values: readonly string[], count: number): void {
  if (values.length !== count) throw new RunnerError("input", `Expected ${count} arguments.`);
}

function usage(): void {
  console.error("Usage:");
  console.error("  ./change-two runner execute <plan.json> <output-dir>");
  console.error("  ./change-two runner timer-start <admin.jsonl> <actor> operator|reviewer");
  console.error("  ./change-two runner timer-stop <admin.jsonl> <timer-id> <actor>");
  console.error("  ./change-two runner timer-correct <admin.jsonl> <timer-id> <actor> <seconds> <reason>");
  console.error("  ./change-two runner intervene <plan.json> <admin.jsonl> <actor> <category> <text> <justification|->");
}
