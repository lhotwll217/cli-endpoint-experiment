"use client";

import * as React from "react";
import {
  APPROACHES,
  type Approach,
  type BenchmarkChatMessage,
  type BenchmarkStreamEvent,
  type RunMetrics,
  type RunStatus,
  type ToolTrace,
} from "@/core/domain/benchmark";
import { createEmptyMetrics } from "@/core/application/metrics";
import { getApproachPromptProfile } from "@/config/agent-prompts";
import { benchmarkLoc } from "@/config/loc.config";
import { benchmarkReducer, createInitialBenchmarkState } from "@/features/benchmark/benchmark-reducer";
import { runBenchmarkRequest } from "@/features/benchmark/benchmark-api";

export type BenchmarkChatEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  approaches?: Approach[];
  approach?: Approach;
  status?: RunStatus;
  metrics?: RunMetrics;
  traces?: ToolTrace[];
  error?: string;
};

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useBenchmarkChat() {
  const [runs, dispatch] = React.useReducer(benchmarkReducer, "", createInitialBenchmarkState);
  const [messages, setMessages] = React.useState<BenchmarkChatEntry[]>([]);
  const historyRef = React.useRef<BenchmarkChatEntry[]>([]);
  const controllers = React.useRef(new Map<Approach, AbortController>());
  const activeAssistantIds = React.useRef(new Map<Approach, string>());

  const updateMessages = React.useCallback((updater: (current: BenchmarkChatEntry[]) => BenchmarkChatEntry[]) => {
    setMessages((current) => {
      const next = updater(current);
      historyRef.current = next;
      return next;
    });
  }, []);

  const cancel = React.useCallback(
    (approach?: Approach) => {
      const targets = approach ? [approach] : APPROACHES;

      for (const target of targets) {
        controllers.current.get(target)?.abort();
        controllers.current.delete(target);
        dispatch({ type: "cancel", approach: target });

        const assistantId = activeAssistantIds.current.get(target);
        if (assistantId) {
          updateMessages((current) =>
            current.map((message) =>
              message.id === assistantId && message.status === "running"
                ? { ...message, status: "cancelled", error: "Cancelled." }
                : message,
            ),
          );
          activeAssistantIds.current.delete(target);
        }
      }
    },
    [updateMessages],
  );

  const clear = React.useCallback(() => {
    cancel();
    dispatch({ type: "reset", prompt: "" });
    historyRef.current = [];
    setMessages([]);
  }, [cancel]);

  const send = React.useCallback(
    async (targets: readonly Approach[], content: string) => {
      const prompt = content.trim();
      if (!prompt || targets.length === 0) {
        return;
      }

      cancel();

      const previous = historyRef.current;
      const userMessage: BenchmarkChatEntry = {
        id: makeId(),
        role: "user",
        content: prompt,
        createdAt: new Date().toISOString(),
        approaches: [...targets],
      };
      const assistantMessages = targets.map((approach) => {
        const message: BenchmarkChatEntry = {
          id: makeId(),
          role: "assistant",
          approach,
          content: "",
          createdAt: new Date().toISOString(),
          status: "running",
          metrics: createEmptyMetrics(benchmarkLoc[approach], getApproachPromptProfile(approach)),
          traces: [],
        };
        activeAssistantIds.current.set(approach, message.id);
        return message;
      });

      const nextHistory = [...previous, userMessage, ...assistantMessages];
      historyRef.current = nextHistory;
      setMessages(nextHistory);

      await Promise.all(
        targets.map(async (approach) => {
          const controller = new AbortController();
          controllers.current.set(approach, controller);

          try {
            await runBenchmarkRequest(approach, prompt, {
              messages: buildApproachHistory([...previous, userMessage], approach),
              signal: controller.signal,
              onEvent: (event) => {
                dispatch({ type: "event", event });
                applyStreamEvent(event, activeAssistantIds.current.get(approach), updateMessages);
              },
            });
          } catch (error) {
            if (controller.signal.aborted) {
              return;
            }

            const failedEvent: BenchmarkStreamEvent = {
              type: "failed",
              approach,
              completedAt: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              metrics: createEmptyMetrics(benchmarkLoc[approach], getApproachPromptProfile(approach)),
              traces: [],
            };
            dispatch({ type: "event", event: failedEvent });
            applyStreamEvent(failedEvent, activeAssistantIds.current.get(approach), updateMessages);
          } finally {
            controllers.current.delete(approach);
            activeAssistantIds.current.delete(approach);
          }
        }),
      );
    },
    [cancel, updateMessages],
  );

  const isRunning = APPROACHES.some((approach) => runs[approach].status === "running");

  React.useEffect(() => () => cancel(), [cancel]);

  return { runs, messages, send, cancel, clear, isRunning };
}

function buildApproachHistory(messages: BenchmarkChatEntry[], approach: Approach): BenchmarkChatMessage[] {
  return messages
    .filter(
      (message) =>
        (message.role === "user" && (!message.approaches || message.approaches.includes(approach))) ||
        message.approach === approach,
    )
    .filter((message) => message.content.trim().length > 0)
    .slice(-18)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function applyStreamEvent(
  event: BenchmarkStreamEvent,
  assistantId: string | undefined,
  updateMessages: (updater: (current: BenchmarkChatEntry[]) => BenchmarkChatEntry[]) => void,
) {
  if (!assistantId) {
    return;
  }

  updateMessages((current) =>
    current.map((message) => {
      if (message.id !== assistantId) {
        return message;
      }

      if (event.type === "started") {
        return { ...message, status: "running", metrics: event.metrics };
      }

      if (event.type === "text") {
        return { ...message, content: message.content + event.delta };
      }

      if (event.type === "trace") {
        return { ...message, traces: [...(message.traces ?? []), event.trace].slice(-80) };
      }

      if (event.type === "metrics") {
        return { ...message, metrics: event.metrics };
      }

      if (event.type === "completed") {
        return {
          ...message,
          status: "succeeded",
          content: event.text,
          metrics: event.metrics,
          traces: event.traces,
        };
      }

      return {
        ...message,
        status: "failed",
        error: event.error,
        metrics: event.metrics,
        traces: event.traces,
      };
    }),
  );
}
