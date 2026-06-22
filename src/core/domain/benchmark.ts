export const APPROACHES = ["cli", "api", "mcp"] as const;

export type Approach = (typeof APPROACHES)[number];
export type ApproachSelection = Approach | "all";

export type RunStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type RunMetrics = TokenUsage & {
  latencyMs: number;
  toolCalls: number;
  outputBytes: number;
  loc: number;
  systemPromptChars: number;
  systemPromptBytes: number;
  toolPromptChars: number;
  toolPromptBytes: number;
};

export type ToolTrace = {
  id: string;
  at: string;
  approach: Approach;
  phase:
    | "tool-call"
    | "tool-result"
    | "tool-error"
    | "stdout"
    | "stderr"
    | "exit"
    | "system";
  toolName: string;
  input?: unknown;
  output?: unknown;
  durationMs?: number;
  error?: string;
};

export type BenchmarkRun = {
  id: string;
  approach: Approach;
  prompt: string;
  status: RunStatus;
  startedAt?: string;
  completedAt?: string;
  text: string;
  traces: ToolTrace[];
  metrics: RunMetrics;
  error?: string;
};

export type BenchmarkTask = {
  id: string;
  title: string;
  prompt: string;
};

export type BenchmarkChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type BenchmarkStreamEvent =
  | {
      type: "started";
      runId: string;
      approach: Approach;
      startedAt: string;
      metrics: RunMetrics;
    }
  | {
      type: "text";
      approach: Approach;
      delta: string;
    }
  | {
      type: "trace";
      approach: Approach;
      trace: ToolTrace;
    }
  | {
      type: "metrics";
      approach: Approach;
      metrics: RunMetrics;
    }
  | {
      type: "completed";
      approach: Approach;
      completedAt: string;
      text: string;
      metrics: RunMetrics;
      traces: ToolTrace[];
    }
  | {
      type: "failed";
      approach: Approach;
      completedAt: string;
      error: string;
      metrics: RunMetrics;
      traces: ToolTrace[];
    };
