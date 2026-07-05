import type { Approach } from "@/core/domain/benchmark";

const sharedAgentIdentity = [
  "You are running a benchmark of PostHog agent integration ergonomics.",
  "Complete the user's analytics task using only the available PostHog integration surface.",
  "Keep final answers concise, evidence-based, and useful for comparing implementation approaches.",
  "Do not invent PostHog data if a tool fails; explain the failure briefly.",
].join("\n");

const approachToolPrompts: Record<Approach, string> = {
  cli: [
    "You have a terminal-like PostHog CLI tool named posthog_cli.",
    "It is already authenticated for the current PostHog project/environment.",
    "Run `posthog-cli skill` for the usage guide, or discover commands with --help.",
  ].join("\n"),
  mcp: [
    "You have PostHog MCP tools discovered from the MCP server at runtime.",
    "Use the discovered read-only tool names and schemas to choose the smallest call that answers the user.",
    "Summarize only the data needed for the benchmark comparison.",
  ].join("\n"),
};

export type ApproachPromptProfile = {
  systemPromptChars: number;
  systemPromptBytes: number;
  toolPromptChars: number;
  toolPromptBytes: number;
};

export function buildApproachSystemPrompt(approach: Approach): string {
  return [sharedAgentIdentity, approachToolPrompts[approach]].join("\n\n");
}

export function getApproachPromptProfile(approach: Approach): ApproachPromptProfile {
  const toolPrompt = approachToolPrompts[approach];
  const systemPrompt = buildApproachSystemPrompt(approach);

  return {
    systemPromptChars: systemPrompt.length,
    systemPromptBytes: byteLength(systemPrompt),
    toolPromptChars: toolPrompt.length,
    toolPromptBytes: byteLength(toolPrompt),
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
