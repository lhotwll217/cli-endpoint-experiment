import { describe, expect, it } from "vitest";
import { benchmarkReducer, createInitialBenchmarkState } from "@/features/benchmark/benchmark-reducer";

describe("benchmarkReducer", () => {
  it("starts and completes a run", () => {
    let state = createInitialBenchmarkState("test prompt");
    state = benchmarkReducer(state, {
      type: "event",
      event: {
        type: "started",
        runId: "run-1",
        approach: "cli",
        startedAt: "2026-05-01T00:00:00.000Z",
        metrics: state.cli.metrics,
      },
    });

    expect(state.cli.status).toBe("running");

    state = benchmarkReducer(state, {
      type: "event",
      event: {
        type: "text",
        approach: "cli",
        delta: "hello",
      },
    });

    state = benchmarkReducer(state, {
      type: "event",
      event: {
        type: "completed",
        approach: "cli",
        completedAt: "2026-05-01T00:00:01.000Z",
        text: "hello",
        metrics: { ...state.cli.metrics, totalTokens: 12 },
        traces: [],
      },
    });

    expect(state.cli.status).toBe("succeeded");
    expect(state.cli.text).toBe("hello");
    expect(state.cli.metrics.totalTokens).toBe(12);
  });

  it("keeps other approaches independent", () => {
    const state = benchmarkReducer(createInitialBenchmarkState("prompt"), {
      type: "event",
      event: {
        type: "failed",
        approach: "mcp",
        completedAt: "2026-05-01T00:00:00.000Z",
        error: "missing key",
        metrics: createInitialBenchmarkState("prompt").mcp.metrics,
        traces: [],
      },
    });

    expect(state.mcp.status).toBe("failed");
    expect(state.cli.status).toBe("idle");
  });
});
