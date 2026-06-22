import { z } from "zod";
import { getServerEnv } from "@/config/env";
import { runPostHogCliStream } from "@/infrastructure/cli/cli-runner";

export const runtime = "nodejs";

const cliRequestSchema = z.object({
  command: z.string().min(1),
});

function encodeSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  const parsed = cliRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ error: "Expected JSON body with a command string." }, { status: 400 });
  }

  const env = getServerEnv();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runPostHogCliStream(parsed.data.command, {
          timeoutMs: env.posthogCliTimeoutMs,
          outputLimitBytes: env.posthogCliOutputLimitBytes,
          env: {
            ...process.env,
            POSTHOG_CLI_HOST: env.posthogHost,
            POSTHOG_CLI_API_KEY: env.posthogPersonalApiKey ?? process.env.POSTHOG_CLI_API_KEY,
            POSTHOG_CLI_PROJECT_ID:
              env.posthogEnvironmentId ?? env.posthogProjectId ?? process.env.POSTHOG_CLI_PROJECT_ID,
          },
        })) {
          controller.enqueue(encodeSse(event.type, event));
        }
      } catch (error) {
        controller.enqueue(
          encodeSse("error", {
            message: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
