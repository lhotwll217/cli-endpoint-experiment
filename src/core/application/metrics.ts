import type { RunMetrics, TokenUsage } from "@/core/domain/benchmark";
import type { ApproachPromptProfile } from "@/config/agent-prompts";

export function createEmptyMetrics(loc: number, promptProfile?: ApproachPromptProfile): RunMetrics {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    latencyMs: 0,
    toolCalls: 0,
    outputBytes: 0,
    loc,
    systemPromptChars: promptProfile?.systemPromptChars ?? 0,
    systemPromptBytes: promptProfile?.systemPromptBytes ?? 0,
    toolPromptChars: promptProfile?.toolPromptChars ?? 0,
    toolPromptBytes: promptProfile?.toolPromptBytes ?? 0,
  };
}

export function normalizeTokenUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): TokenUsage {
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;

  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
  };
}

export function estimateBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
