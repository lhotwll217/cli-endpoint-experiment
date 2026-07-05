// The `posthog-cli skill` meta-command. The wrapper answers it server-side —
// the real binary never runs — so the surface documents itself through the
// same grammar the agent already uses. Root --help advertises it; the agent
// spends these tokens only when it chooses to read them.
export const CLI_SKILL_COMMAND = "skill";

export const CLI_SKILL_TEXT = `---
name: posthog-http-cli
description: Query PostHog analytics through one HTTP endpoint that accepts posthog-cli command strings. Use for pageviews, product events, HogQL queries, and connected data-warehouse tables.
---

# PostHog HTTP CLI

This surface is a single endpoint that runs one posthog-cli invocation per
call and streams back stdout/stderr/exit data:

    POST /api/cli
    {"command": "posthog-cli --help"}

Authentication and project selection are handled server-side. You only write
commands.

## How to work

1. Discover, don't guess: run \`posthog-cli --help\`, then \`<subcommand> --help\`
   for exact flags before using an unfamiliar command.
2. For analytics questions, use the query subcommand (see
   \`posthog-cli exp query run --help\`) with a read-only HogQL SELECT.
3. Keep queries small and aggregated. Prefer counts, GROUP BY, and LIMIT over
   dumping raw events.

## HogQL tips that save round-trips

- Events live in the \`events\` table: \`event\`, \`timestamp\`, \`person_id\`,
  and JSON \`properties\` (access as \`properties.$pathname\`,
  \`properties.$current_url\`, \`properties.$device_type\`).
- Filter dates with \`toDate(timestamp) >= toDate('2026-06-01')\`.
- Connected data-warehouse tables (for example Google Ads imports) are
  queryable by table name in the same HogQL statement. Discover them by
  querying and reading error hints, or through saved dashboards/insights.
- Week bucketing: \`toStartOfWeek(timestamp, 1)\` (Monday start).

## Rules

- One invocation per call. No shell syntax: pipes, redirects, \`&&\`, \`;\`,
  backticks, and \`$()\` are rejected.
- Read-only usage. Do not attempt mutating commands.
- Output is capped and secrets are redacted; long results are truncated, so
  aggregate server-side instead of paginating raw data.

## Examples

    posthog-cli exp query run "SELECT properties.$pathname AS path, count() AS views FROM events WHERE event = '$pageview' AND toDate(timestamp) >= toDate('2026-06-01') GROUP BY path ORDER BY views DESC LIMIT 10"

    posthog-cli exp query run "SELECT event, count() FROM events WHERE toDate(timestamp) >= toDate('2026-06-15') GROUP BY event ORDER BY count() DESC LIMIT 25"
`;

export function isSkillCommand(argv: string[]): boolean {
  return argv.length === 2 && argv[1] === CLI_SKILL_COMMAND;
}

export function isRootHelpCommand(argv: string[]): boolean {
  return argv.length === 2 && (argv[1] === "--help" || argv[1] === "-h" || argv[1] === "help");
}

export const CLI_HELP_SKILL_ADDENDUM = [
  "",
  "Agent guide (served by this endpoint, not the binary):",
  "  skill    Print the usage guide for agents — read it once before other commands",
  "",
].join("\n");
