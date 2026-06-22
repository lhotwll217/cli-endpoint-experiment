import type { AgentRunRequest, AgentRunner, EmitBenchmarkEvent } from "@/core/ports/agent-runner";

export async function runBenchmark(
  runner: AgentRunner,
  request: AgentRunRequest,
  emit: EmitBenchmarkEvent,
): Promise<void> {
  await runner.run(request, emit);
}
