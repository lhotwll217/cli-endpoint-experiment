import type { Approach, BenchmarkChatMessage, BenchmarkStreamEvent } from "@/core/domain/benchmark";

export type EmitBenchmarkEvent = (event: BenchmarkStreamEvent) => void | Promise<void>;

export type AgentRunRequest = {
  approach: Approach;
  prompt: string;
  messages?: BenchmarkChatMessage[];
  abortSignal?: AbortSignal;
};

export interface AgentRunner {
  run(request: AgentRunRequest, emit: EmitBenchmarkEvent): Promise<void>;
}
