import type { ToolSet } from "ai";
import type { Approach, ToolTrace } from "@/core/domain/benchmark";

export type TraceRecorder = (trace: ToolTrace) => void;

export interface PostHogIntegrationAdapter {
  readonly approach: Approach;
  createTools(recordTrace: TraceRecorder): Promise<ToolSet>;
}
