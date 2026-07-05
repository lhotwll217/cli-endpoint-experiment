import type { Approach, RunStatus } from "@/core/domain/benchmark";

export const appTheme = {
  radius: "0.5rem",
  approaches: {
    cli: {
      label: "HTTP CLI",
      description: "One HTTP endpoint that accepts a CLI command string; the agent discovers the surface via --help.",
      cssVar: "var(--approach-cli)",
      softCssVar: "var(--approach-cli-soft)",
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
