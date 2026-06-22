"use client";

import * as React from "react";
import { APPROACHES, type Approach, type ApproachSelection, type BenchmarkStreamEvent } from "@/core/domain/benchmark";
import { createEmptyMetrics } from "@/core/application/metrics";
import { getApproachPromptProfile } from "@/config/agent-prompts";
import { benchmarkLoc } from "@/config/loc.config";
import { benchmarkReducer, createInitialBenchmarkState } from "@/features/benchmark/benchmark-reducer";
import { runBenchmarkRequest } from "@/features/benchmark/benchmark-api";

export function useBenchmarkRuns(initialPrompt: string) {
  const [state, dispatch] = React.useReducer(benchmarkReducer, initialPrompt, createInitialBenchmarkState);
  const controllers = React.useRef(new Map<Approach, AbortController>());

  const cancel = React.useCallback((approach?: Approach) => {
    const targets = approach ? [approach] : APPROACHES;
    for (const target of targets) {
      controllers.current.get(target)?.abort();
      controllers.current.delete(target);
      dispatch({ type: "cancel", approach: target });
    }
  }, []);

  const run = React.useCallback(
    async (selection: ApproachSelection, prompt: string) => {
      cancel();
      dispatch({ type: "reset", prompt });

      const targets = selection === "all" ? APPROACHES : [selection];

      await Promise.all(
        targets.map(async (approach) => {
          const controller = new AbortController();
          controllers.current.set(approach, controller);

          try {
            await runBenchmarkRequest(approach, prompt, {
              signal: controller.signal,
              onEvent: (event: BenchmarkStreamEvent) => dispatch({ type: "event", event }),
            });
          } catch (error) {
            if (controller.signal.aborted) {
              return;
            }
            dispatch({
              type: "event",
              event: {
                type: "failed",
                approach,
                completedAt: new Date().toISOString(),
                error: error instanceof Error ? error.message : String(error),
                metrics: createEmptyMetrics(benchmarkLoc[approach], getApproachPromptProfile(approach)),
                traces: [],
              },
            });
          } finally {
            controllers.current.delete(approach);
          }
        }),
      );
    },
    [cancel],
  );

  const isRunning = APPROACHES.some((approach) => state[approach].status === "running");

  React.useEffect(() => () => cancel(), [cancel]);

  return { state, run, cancel, isRunning };
}
