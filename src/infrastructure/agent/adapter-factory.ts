import type { Approach } from "@/core/domain/benchmark";
import type { PostHogIntegrationAdapter } from "@/core/ports/posthog-integration";
import type { ServerEnv } from "@/config/env";
import { ApiPostHogAdapter } from "@/infrastructure/posthog-api/api-adapter";
import { CliPostHogAdapter } from "@/infrastructure/cli/cli-adapter";
import { McpPostHogAdapter } from "@/infrastructure/posthog-mcp/mcp-adapter";

export function createPostHogAdapter(approach: Approach, env: ServerEnv): PostHogIntegrationAdapter {
  if (approach === "cli") {
    return new CliPostHogAdapter(env);
  }

  if (approach === "api") {
    return new ApiPostHogAdapter(env);
  }

  return new McpPostHogAdapter(env);
}
