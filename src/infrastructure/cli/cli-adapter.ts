import { randomUUID } from "node:crypto";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { PostHogIntegrationAdapter, TraceRecorder } from "@/core/ports/posthog-integration";
import { executePostHogCli } from "@/infrastructure/cli/cli-runner";
import type { ServerEnv } from "@/config/env";

export class CliPostHogAdapter implements PostHogIntegrationAdapter {
  readonly approach = "cli" as const;

  constructor(private readonly env: ServerEnv) {}

  async createTools(recordTrace: TraceRecorder): Promise<ToolSet> {
    return {
      posthog_cli: tool({
        description: [
          "Run a PostHog CLI command. The command must start with posthog-cli.",
          'Run "posthog-cli skill" once for the usage guide, or discover the surface with --help commands, then run read-only commands.',
        ].join(" "),
        inputSchema: z.object({
          command: z
            .string()
            .describe('A single PostHog CLI invocation, for example "posthog-cli --help".'),
        }),
        execute: async ({ command }) => {
          const started = Date.now();
          recordTrace({
            id: randomUUID(),
            at: new Date(started).toISOString(),
            approach: "cli",
            phase: "tool-call",
            toolName: "posthog_cli",
            input: { command },
          });

          try {
            const result = await executePostHogCli(command, {
              timeoutMs: this.env.posthogCliTimeoutMs,
              outputLimitBytes: this.env.posthogCliOutputLimitBytes,
              env: {
                ...process.env,
                POSTHOG_CLI_HOST: this.env.posthogHost,
                POSTHOG_CLI_API_KEY: this.env.posthogPersonalApiKey ?? process.env.POSTHOG_CLI_API_KEY,
                POSTHOG_CLI_PROJECT_ID:
                  this.env.posthogEnvironmentId ?? this.env.posthogProjectId ?? process.env.POSTHOG_CLI_PROJECT_ID,
              },
            });

            const output = {
              code: result.code,
              signal: result.signal,
              durationMs: result.durationMs,
              stdout: redactCliOutput(result.stdout).slice(0, 16_000),
              stderr: redactCliOutput(result.stderr).slice(0, 8_000),
              stdoutBytes: result.stdoutBytes,
              stderrBytes: result.stderrBytes,
              truncated: result.truncated,
            };
            const errorOutput = redactCliOutput(result.stderr || `Exited with code ${result.code}`);

            recordTrace({
              id: randomUUID(),
              at: new Date().toISOString(),
              approach: "cli",
              phase: result.code === 0 ? "tool-result" : "tool-error",
              toolName: "posthog_cli",
              input: { command },
              output,
              durationMs: Date.now() - started,
              error: result.code === 0 ? undefined : errorOutput,
            });

            return output;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            recordTrace({
              id: randomUUID(),
              at: new Date().toISOString(),
              approach: "cli",
              phase: "tool-error",
              toolName: "posthog_cli",
              input: { command },
              durationMs: Date.now() - started,
              error: message,
            });
            throw error;
          }
        },
      }),
    };
  }
}

function redactCliOutput(value: string): string {
  return value
    .replace(/phc_[A-Za-z0-9_-]+/g, "[REDACTED_POSTHOG_TOKEN]")
    .replace(/(POSTHOG_(?:PERSONAL_)?API_KEY=)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/("?(?:token|api[_-]?key|authorization|secret|password)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[REDACTED]$3");
}
