import type { Approach, BenchmarkChatMessage, BenchmarkStreamEvent } from "@/core/domain/benchmark";

export async function runBenchmarkRequest(
  approach: Approach,
  prompt: string,
  options: {
    messages?: BenchmarkChatMessage[];
    signal: AbortSignal;
    onEvent: (event: BenchmarkStreamEvent) => void;
  },
) {
  const response = await fetch("/api/benchmark/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approach, prompt, messages: options.messages }),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const body = await response.text();
    throw new Error(body || `Benchmark request failed with ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      options.onEvent(JSON.parse(line) as BenchmarkStreamEvent);
    }
  }

  if (buffer.trim()) {
    options.onEvent(JSON.parse(buffer) as BenchmarkStreamEvent);
  }
}
