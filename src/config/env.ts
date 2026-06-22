function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function splitEnvArgs(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to whitespace splitting for simple local command config.
  }

  return value.split(/\s+/).filter(Boolean);
}

export type ServerEnv = {
  openAiApiKey?: string;
  openAiModel: string;
  openAiReasoningEffort: string;
  posthogHost: string;
  posthogPersonalApiKey?: string;
  posthogProjectId?: string;
  posthogEnvironmentId?: string;
  posthogOrganizationId?: string;
  posthogCliTimeoutMs: number;
  posthogCliOutputLimitBytes: number;
  posthogMcpUrl: string;
  posthogMcpCommand?: string;
  posthogMcpArgs?: string[];
  posthogMcpAuthHeader?: string;
};

export function getServerEnv(): ServerEnv {
  const personalApiKey = optionalEnv("POSTHOG_PERSONAL_API_KEY");
  const mcpAuthHeader =
    optionalEnv("POSTHOG_MCP_AUTH_HEADER") ?? (personalApiKey ? `Bearer ${personalApiKey}` : undefined);

  return {
    openAiApiKey: optionalEnv("OPENAI_API_KEY"),
    openAiModel: optionalEnv("OPENAI_MODEL") ?? "gpt-5.4",
    openAiReasoningEffort: optionalEnv("OPENAI_REASONING_EFFORT") ?? "low",
    posthogHost: optionalEnv("POSTHOG_HOST") ?? "https://us.posthog.com",
    posthogPersonalApiKey: personalApiKey,
    posthogProjectId: optionalEnv("POSTHOG_PROJECT_ID"),
    posthogEnvironmentId: optionalEnv("POSTHOG_ENVIRONMENT_ID") ?? optionalEnv("POSTHOG_PROJECT_ID"),
    posthogOrganizationId: optionalEnv("POSTHOG_ORGANIZATION_ID"),
    posthogCliTimeoutMs: Number(optionalEnv("POSTHOG_CLI_TIMEOUT_MS") ?? 30_000),
    posthogCliOutputLimitBytes: Number(optionalEnv("POSTHOG_CLI_OUTPUT_LIMIT_BYTES") ?? 120_000),
    posthogMcpUrl: optionalEnv("POSTHOG_MCP_URL") ?? "https://mcp.posthog.com/mcp",
    posthogMcpCommand: optionalEnv("POSTHOG_MCP_COMMAND"),
    posthogMcpArgs: splitEnvArgs(optionalEnv("POSTHOG_MCP_ARGS")),
    posthogMcpAuthHeader: mcpAuthHeader,
  };
}
