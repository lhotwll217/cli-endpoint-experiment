import type { Approach, BenchmarkRun, BenchmarkStreamEvent } from "@/core/domain/benchmark";
import { createEmptyMetrics } from "@/core/application/metrics";
import { getApproachPromptProfile } from "@/config/agent-prompts";
import { benchmarkLoc } from "@/config/loc.config";

export type BenchmarkState = Record<Approach, BenchmarkRun>;

export type BenchmarkAction =
  | { type: "reset"; prompt: string }
  | { type: "event"; event: BenchmarkStreamEvent }
  | { type: "cancel"; approach: Approach };

export function createInitialBenchmarkState(prompt = ""): BenchmarkState {
  return {
    cli: createIdleRun("cli", prompt),
    mcp: createIdleRun("mcp", prompt),
  };
}

function createIdleRun(approach: Approach, prompt: string): BenchmarkRun {
  return {
    id: `${approach}-idle`,
    approach,
    prompt,
    status: "idle",
    text: "",
    traces: [],
    metrics: createEmptyMetrics(benchmarkLoc[approach], getApproachPromptProfile(approach)),
  };
}

export function benchmarkReducer(state: BenchmarkState, action: BenchmarkAction): BenchmarkState {
  if (action.type === "reset") {
    return createInitialBenchmarkState(action.prompt);
  }

  if (action.type === "cancel") {
    const current = state[action.approach];
    return {
      ...state,
      [action.approach]: {
        ...current,
        status: current.status === "running" ? "cancelled" : current.status,
        completedAt: new Date().toISOString(),
      },
    };
  }

  const event = action.event;
  const current = state[event.approach];

  if (event.type === "started") {
    return {
      ...state,
      [event.approach]: {
        ...current,
        id: event.runId,
        status: "running",
        startedAt: event.startedAt,
        completedAt: undefined,
        text: "",
        traces: [],
        error: undefined,
        metrics: event.metrics,
      },
    };
  }

  if (event.type === "text") {
    return {
      ...state,
      [event.approach]: {
        ...current,
        text: current.text + event.delta,
      },
    };
  }

  if (event.type === "trace") {
    return {
      ...state,
      [event.approach]: {
        ...current,
        traces: [...current.traces, event.trace].slice(-80),
      },
    };
  }

  if (event.type === "metrics") {
    return {
      ...state,
      [event.approach]: {
        ...current,
        metrics: event.metrics,
      },
    };
  }

  if (event.type === "completed") {
    return {
      ...state,
      [event.approach]: {
        ...current,
        status: "succeeded",
        completedAt: event.completedAt,
        text: event.text,
        traces: event.traces,
        metrics: event.metrics,
      },
    };
  }

  return {
    ...state,
    [event.approach]: {
      ...current,
      status: "failed",
      completedAt: event.completedAt,
      error: event.error,
      metrics: event.metrics,
      traces: event.traces,
    },
  };
}
