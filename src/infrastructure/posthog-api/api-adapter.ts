import { randomUUID } from "node:crypto";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ServerEnv } from "@/config/env";
import type { PostHogIntegrationAdapter, TraceRecorder } from "@/core/ports/posthog-integration";
import { PostHogApiClient, summarizeUnknown } from "@/infrastructure/posthog-api/posthog-api-client";

export class ApiPostHogAdapter implements PostHogIntegrationAdapter {
  readonly approach = "api" as const;
  private readonly client: PostHogApiClient;

  constructor(env: ServerEnv) {
    this.client = new PostHogApiClient(env);
  }

  async createTools(recordTrace: TraceRecorder): Promise<ToolSet> {
    return {
      posthog_list_projects: tool({
        description:
          "List PostHog projects in the configured organization. Use this to understand available project context.",
        inputSchema: z.object({
          limit: z.number().int().min(1).max(50).default(20),
        }),
        execute: ({ limit }) => this.call("posthog_list_projects", { limit }, recordTrace, () => this.client.listProjects(limit)),
      }),
      posthog_query_hogql: tool({
        description:
          "Run a read-only HogQL query against the configured PostHog project. Use SELECT queries only.",
        inputSchema: z.object({
          query: z.string().describe("A read-only HogQL SELECT query."),
        }),
        execute: ({ query }) => {
          if (!/^\s*(select|show|with)\b/i.test(query)) {
            throw new Error("Only read-only HogQL SELECT, SHOW, or WITH queries are allowed.");
          }
          return this.call("posthog_query_hogql", { query }, recordTrace, () => this.client.queryHogQL(query));
        },
      }),
      posthog_list_insights: tool({
        description: "List PostHog insights in the configured environment.",
        inputSchema: z.object({
          limit: z.number().int().min(1).max(50).default(20),
        }),
        execute: ({ limit }) => this.call("posthog_list_insights", { limit }, recordTrace, () => this.client.listInsights(limit)),
      }),
      posthog_list_dashboards: tool({
        description: "List PostHog dashboards in the configured environment.",
        inputSchema: z.object({
          limit: z.number().int().min(1).max(50).default(20),
        }),
        execute: ({ limit }) =>
          this.call("posthog_list_dashboards", { limit }, recordTrace, () => this.client.listDashboards(limit)),
      }),
    };
  }

  private async call(
    toolName: string,
    input: unknown,
    recordTrace: TraceRecorder,
    fn: () => Promise<unknown>,
  ): Promise<unknown> {
    const started = Date.now();
    recordTrace({
      id: randomUUID(),
      at: new Date(started).toISOString(),
      approach: "api",
      phase: "tool-call",
      toolName,
      input,
    });

    try {
      const output = await fn();
      recordTrace({
        id: randomUUID(),
        at: new Date().toISOString(),
        approach: "api",
        phase: "tool-result",
        toolName,
        input,
        output,
        durationMs: Date.now() - started,
      });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordTrace({
        id: randomUUID(),
        at: new Date().toISOString(),
        approach: "api",
        phase: "tool-error",
        toolName,
        input,
        durationMs: Date.now() - started,
        error: message,
        output: summarizeUnknown(message),
      });
      throw error;
    }
  }
}
