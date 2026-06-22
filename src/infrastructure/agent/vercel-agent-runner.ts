import { randomUUID } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import { isLoopFinished, streamText } from "ai";
import type { Approach, ToolTrace } from "@/core/domain/benchmark";
import type { AgentRunRequest, AgentRunner, EmitBenchmarkEvent } from "@/core/ports/agent-runner";
import type { LocProvider } from "@/core/ports/loc-provider";
import type { ServerEnv } from "@/config/env";
import { buildApproachSystemPrompt, getApproachPromptProfile } from "@/config/agent-prompts";
import { createEmptyMetrics, estimateBytes, normalizeTokenUsage } from "@/core/application/metrics";
import { createPostHogAdapter } from "@/infrastructure/agent/adapter-factory";

export class ConfigLocProvider implements LocProvider {
  constructor(private readonly locByApproach: Record<Approach, number>) {}

  getLoc(approach: Approach): number {
    return this.locByApproach[approach];
  }
}

export class VercelAiAgentRunner implements AgentRunner {
  constructor(
    private readonly env: ServerEnv,
    private readonly locProvider: LocProvider,
  ) {}

  async run(request: AgentRunRequest, emit: EmitBenchmarkEvent): Promise<void> {
    const started = Date.now();
    const runId = randomUUID();
    const traces: ToolTrace[] = [];
    let text = "";
    let toolCalls = 0;
    let metrics = createEmptyMetrics(
      this.locProvider.getLoc(request.approach),
      getApproachPromptProfile(request.approach),
    );

    const recordTrace = (trace: ToolTrace) => {
      traces.push(trace);
      if (trace.phase === "tool-call") {
        toolCalls += 1;
      }
      void emit({ type: "trace", approach: request.approach, trace });
    };

    await emit({
      type: "started",
      runId,
      approach: request.approach,
      startedAt: new Date(started).toISOString(),
      metrics,
    });

    try {
      if (!this.env.openAiApiKey) {
        throw new Error("OPENAI_API_KEY is required to run the benchmark agent.");
      }

      const adapter = createPostHogAdapter(request.approach, this.env);
      const tools = await adapter.createTools(recordTrace);

      const result = streamText({
        model: openai.responses(this.env.openAiModel),
        system: buildApproachSystemPrompt(request.approach),
        messages: buildModelMessages(request),
        tools,
        providerOptions: {
          openai: {
            reasoningEffort: this.env.openAiReasoningEffort,
          },
        },
        stopWhen: isLoopFinished(),
        maxOutputTokens: 900,
        abortSignal: request.abortSignal,
      });

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          text += part.text;
          await emit({ type: "text", approach: request.approach, delta: part.text });
        }

        if (part.type === "finish") {
          const usage = normalizeTokenUsage(part.totalUsage);
          metrics = {
            ...metrics,
            ...usage,
            latencyMs: Date.now() - started,
            toolCalls,
            outputBytes: estimateBytes(text),
          };
          await emit({ type: "metrics", approach: request.approach, metrics });
        }
      }

      const usage = normalizeTokenUsage(await result.totalUsage);
      const finalText = text.trim().length > 0 ? text : buildFallbackText(traces);

      if (text.trim().length === 0) {
        traces.push({
          id: randomUUID(),
          at: new Date().toISOString(),
          approach: request.approach,
          phase: "system",
          toolName: "agent_runner",
          output: {
            finishReason: await result.finishReason,
            message: "Model finished without assistant text after tool calls.",
          },
        });
      }

      metrics = {
        ...metrics,
        ...usage,
        latencyMs: Date.now() - started,
        toolCalls,
        outputBytes: estimateBytes(finalText),
      };

      await emit({
        type: "completed",
        approach: request.approach,
        completedAt: new Date().toISOString(),
        text: finalText,
        metrics,
        traces,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      metrics = {
        ...metrics,
        latencyMs: Date.now() - started,
        toolCalls,
        outputBytes: estimateBytes(text),
      };
      await emit({
        type: "failed",
        approach: request.approach,
        completedAt: new Date().toISOString(),
        error: message,
        metrics,
        traces,
      });
    }
  }
}

function buildModelMessages(request: AgentRunRequest) {
  const messages = request.messages?.length
    ? request.messages
    : [{ role: "user" as const, content: request.prompt }];

  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function buildFallbackText(traces: ToolTrace[]): string {
  const latestResult = traces.findLast((trace) => trace.phase === "tool-result" || trace.phase === "tool-error");

  if (!latestResult) {
    return "The agent completed without producing a final response and no tool result was captured.";
  }

  if (latestResult.phase === "tool-error") {
    return [
      "The agent completed after a tool error but did not produce a final response.",
      "",
      latestResult.error ? `Error: ${latestResult.error}` : summarizeToolValue(latestResult.output),
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "The agent completed after tool calls but did not produce a final response.",
    "",
    `Latest tool result from ${latestResult.toolName}:`,
    summarizeToolValue(latestResult.output),
  ].join("\n");
}

function summarizeToolValue(value: unknown): string {
  if (value === undefined) {
    return "No output captured.";
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const stdout = typeof record?.stdout === "string" ? record.stdout.trim() : "";
  const stderr = typeof record?.stderr === "string" ? record.stderr.trim() : "";

  if (stdout || stderr) {
    return truncate([stdout, stderr && `stderr:\n${stderr}`].filter(Boolean).join("\n\n"));
  }

  return truncate(JSON.stringify(value, null, 2) ?? String(value));
}

function truncate(value: string, limit = 1_800): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}
