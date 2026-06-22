import { z } from "zod";
import type { BenchmarkStreamEvent } from "@/core/domain/benchmark";
import { APPROACHES } from "@/core/domain/benchmark";
import { runBenchmark } from "@/core/application/run-benchmark";
import { createEmptyMetrics } from "@/core/application/metrics";
import { getApproachPromptProfile } from "@/config/agent-prompts";
import { benchmarkLoc } from "@/config/loc.config";
import { getServerEnv } from "@/config/env";
import { ConfigLocProvider, VercelAiAgentRunner } from "@/infrastructure/agent/vercel-agent-runner";

export const runtime = "nodejs";

const runRequestSchema = z.object({
  approach: z.enum(APPROACHES),
  prompt: z.string().min(1).max(8_000),
  stream: z.boolean().optional().default(true),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(12_000),
      }),
    )
    .max(24)
    .optional(),
});

function encodeNdjson(event: BenchmarkStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export async function POST(request: Request) {
  const parsed = runRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ error: "Expected approach and prompt." }, { status: 400 });
  }

  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort(), { once: true });
  const runner = new VercelAiAgentRunner(getServerEnv(), new ConfigLocProvider(benchmarkLoc));

  if (!parsed.data.stream) {
    const events: BenchmarkStreamEvent[] = [];
    const emit = (event: BenchmarkStreamEvent) => {
      events.push(event);
    };

    try {
      await runBenchmark(
        runner,
        {
          approach: parsed.data.approach,
          prompt: parsed.data.prompt,
          messages: parsed.data.messages,
          abortSignal: abortController.signal,
        },
        emit,
      );
    } catch (error) {
      emit({
        type: "failed",
        approach: parsed.data.approach,
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        metrics: createEmptyMetrics(
          benchmarkLoc[parsed.data.approach],
          getApproachPromptProfile(parsed.data.approach),
        ),
        traces: [],
      });
    }

    const completed = events.findLast((event) => event.type === "completed");
    const failed = events.findLast((event) => event.type === "failed");
    const finalEvent = completed ?? failed;
    const text =
      finalEvent?.type === "completed"
        ? finalEvent.text
        : events
            .filter((event) => event.type === "text")
            .map((event) => event.delta)
            .join("");
    const metrics =
      finalEvent?.type === "completed" || finalEvent?.type === "failed"
        ? finalEvent.metrics
        : createEmptyMetrics(benchmarkLoc[parsed.data.approach], getApproachPromptProfile(parsed.data.approach));
    const traces =
      finalEvent?.type === "completed" || finalEvent?.type === "failed"
        ? finalEvent.traces
        : events.flatMap((event) => (event.type === "trace" ? [event.trace] : []));

    return Response.json({
      approach: parsed.data.approach,
      status: completed ? "succeeded" : "failed",
      output: text,
      error: failed?.type === "failed" ? failed.error : undefined,
      metrics,
      traces,
      tokenUsage: {
        prompt: metrics.promptTokens,
        completion: metrics.completionTokens,
        total: metrics.totalTokens,
      },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: BenchmarkStreamEvent) => {
        controller.enqueue(encodeNdjson(event));
      };

      try {
        await runBenchmark(
          runner,
          {
            approach: parsed.data.approach,
            prompt: parsed.data.prompt,
            messages: parsed.data.messages,
            abortSignal: abortController.signal,
          },
          emit,
        );
      } catch (error) {
        emit({
          type: "failed",
          approach: parsed.data.approach,
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
          metrics: createEmptyMetrics(
            benchmarkLoc[parsed.data.approach],
            getApproachPromptProfile(parsed.data.approach),
          ),
          traces: [],
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
