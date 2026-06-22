# PostHog Integration Benchmark Demo

Next.js demo app for comparing three PostHog agent integration approaches:

- CLI: one string-only `posthog-cli` tool exposed through `/api/cli`.
- API: typed read-only tools backed by the PostHog API.
- MCP: read-only tools discovered from a PostHog MCP server.

The dashboard can run one approach or all three in parallel, then displays real model token usage, latency, tool-call count, output bytes, and curated LOC values for blog/video reporting.

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3322](http://localhost:3322).

Required for benchmark runs:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`, defaults to `gpt-5.4`
- `OPENAI_REASONING_EFFORT`, defaults to `low`
- `POSTHOG_PERSONAL_API_KEY`
- `POSTHOG_PROJECT_ID`
- `POSTHOG_ORGANIZATION_ID` for project listing
- `POSTHOG_ENVIRONMENT_ID` for insights/dashboards, or it falls back to `POSTHOG_PROJECT_ID`

CLI mode uses the local `@posthog/cli` package when available and otherwise falls back to `posthog-cli` on the server PATH. MCP mode defaults to `https://mcp.posthog.com/mcp` and uses `POSTHOG_MCP_AUTH_HEADER` when set, otherwise `Bearer ${POSTHOG_PERSONAL_API_KEY}`.

## Scripts

```bash
npm run dev
npm run build
npm run eval
npm run eval -- --filter-first-n 1
npm run eval -- --filter-providers posthog-agent:cli
npm run eval -- --var prompt="Find recent useful PostHog events"
npm run lint
npm run test
```

Evals use Promptfoo directly. Eval configs, helpers, Promptfoo state, and run artifacts all live under `evals/`. `npm run eval` writes reports to `evals/eval_runs/latest.json` and `evals/eval_runs/latest.html`; timestamped real-world runs go under `evals/eval_runs/<timestamp>_<label>/`.

## Architecture

- `src/app`: Next routes and pages.
- `src/features/benchmark`: dashboard, reducer, streaming client.
- `src/core/domain`: shared benchmark types.
- `src/core/application`: orchestration and metrics helpers.
- `src/core/ports`: adapter contracts.
- `src/infrastructure`: CLI, API, MCP, and AI SDK adapters.
- `src/config`: tasks, LOC values, env parsing, and theme metadata.
