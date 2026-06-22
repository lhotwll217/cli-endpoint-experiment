import type { Approach, RunStatus } from "@/core/domain/benchmark";

export const appTheme = {
  radius: "0.5rem",
  approaches: {
    cli: {
      label: "CLI",
      description: "One HTTP tool that takes a PostHog CLI string.",
      cssVar: "var(--approach-cli)",
      softCssVar: "var(--approach-cli-soft)",
    },
    api: {
      label: "API",
      description: "Typed tools backed by direct PostHog API calls.",
      cssVar: "var(--approach-api)",
      softCssVar: "var(--approach-api-soft)",
    },
    mcp: {
      label: "MCP",
      description: "Discovered PostHog MCP tools exposed to the agent.",
      cssVar: "var(--approach-mcp)",
      softCssVar: "var(--approach-mcp-soft)",
    },
  } satisfies Record<Approach, { label: string; description: string; cssVar: string; softCssVar: string }>,
  statuses: {
    idle: "var(--status-idle)",
    running: "var(--status-running)",
    succeeded: "var(--status-succeeded)",
    failed: "var(--status-failed)",
    cancelled: "var(--status-cancelled)",
  } satisfies Record<RunStatus, string>,
};

export function getApproachTheme(approach: Approach) {
  return appTheme.approaches[approach];
}
