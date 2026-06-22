import { describe, expect, it } from "vitest";
import { createEmptyMetrics, estimateBytes, normalizeTokenUsage } from "@/core/application/metrics";

describe("metrics", () => {
  it("creates empty metrics with configured LOC", () => {
    expect(createEmptyMetrics(42)).toMatchObject({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      toolCalls: 0,
      outputBytes: 0,
      loc: 42,
      systemPromptChars: 0,
      systemPromptBytes: 0,
      toolPromptChars: 0,
      toolPromptBytes: 0,
    });
  });

  it("adds prompt profile metrics when provided", () => {
    expect(
      createEmptyMetrics(42, {
        systemPromptChars: 10,
        systemPromptBytes: 11,
        toolPromptChars: 5,
        toolPromptBytes: 6,
      }),
    ).toMatchObject({
      systemPromptChars: 10,
      systemPromptBytes: 11,
      toolPromptChars: 5,
      toolPromptBytes: 6,
    });
  });

  it("normalizes AI SDK token usage", () => {
    expect(normalizeTokenUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("estimates UTF-8 bytes", () => {
    expect(estimateBytes("abc")).toBe(3);
  });
});
