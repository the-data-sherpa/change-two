import type { HarnessAdapter, HarnessInvocation, RunPlan } from "./types.js";

function promptArgument(promptPath: string): string {
  return `Read ${promptPath} and implement it completely. Work only in /workspace. When complete, report completion; the runner owns verification.`;
}

abstract class JsonLineAdapter implements HarnessAdapter {
  abstract readonly kind: HarnessAdapter["kind"];
  abstract createInvocation(plan: RunPlan, promptPath: string): HarnessInvocation;

  normalizeLine(stream: "stdout" | "stderr", line: string) {
    let providerFields: Readonly<Record<string, unknown>> | null = null;
    if (stream === "stdout") {
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) providerFields = parsed as Readonly<Record<string, unknown>>;
      } catch {
        // Provider output is retained verbatim when it is not JSON.
      }
    }
    return {
      eventType: providerFields === null ? `harness-${stream}` : "provider-event",
      payload: { line, stream },
      providerFields,
    } as const;
  }
}

class ClaudeCodeAdapter extends JsonLineAdapter {
  readonly kind = "claude-code" as const;

  createInvocation(plan: RunPlan, promptPath: string): HarnessInvocation {
    return {
      command: ["npx", "--yes", `@anthropic-ai/claude-code@${plan.harness.version}`, "-p", promptArgument(promptPath), "--output-format", "stream-json", "--verbose", "--model", plan.harness.model, "--dangerously-skip-permissions"],
      environment: {},
      sourceName: `claude-code@${plan.harness.version}`,
    };
  }
}

class CodexAdapter extends JsonLineAdapter {
  readonly kind = "codex" as const;

  createInvocation(plan: RunPlan, promptPath: string): HarnessInvocation {
    return {
      command: ["npx", "--yes", `@openai/codex@${plan.harness.version}`, "exec", "--json", "--model", plan.harness.model, "--dangerously-bypass-approvals-and-sandbox", promptArgument(promptPath)],
      environment: {},
      sourceName: `codex@${plan.harness.version}`,
    };
  }
}

class SyntheticAdapter extends JsonLineAdapter {
  readonly kind = "synthetic" as const;

  createInvocation(plan: RunPlan): HarnessInvocation {
    if (plan.harness.syntheticCommand === undefined || plan.harness.syntheticCommand.length === 0) throw new Error("A synthetic harness requires syntheticCommand.");
    return { command: plan.harness.syntheticCommand, environment: {}, sourceName: `synthetic@${plan.harness.version}` };
  }
}

const adapters: Readonly<Record<RunPlan["harness"]["kind"], HarnessAdapter>> = {
  "claude-code": new ClaudeCodeAdapter(),
  codex: new CodexAdapter(),
  synthetic: new SyntheticAdapter(),
};

export function harnessAdapter(kind: RunPlan["harness"]["kind"]): HarnessAdapter {
  return adapters[kind];
}
