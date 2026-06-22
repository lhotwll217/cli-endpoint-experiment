# CLI Endpoint Experiment

This repo explores a specific agent-integration question:

> What would it look like to expose an existing CLI as a simple HTTP-streamable
> agent tool, and how does that compare with MCP and hand-written API tools?

The experiment uses PostHog as the real integration target because it has all
three surfaces worth comparing:

- A CLI: `posthog-cli`
- A direct HTTP API
- An MCP server

The goal is not to build the best PostHog client. The goal is to compare the
ergonomics and runtime cost of three ways to give an agent access to the same
product data.

## What Is Being Compared?

### CLI Endpoint

The CLI approach exposes one narrow tool to the agent:

```ts
posthog_cli({ command: string })
```

That tool calls an internal HTTP endpoint, `POST /api/cli`, which validates a
single `posthog-cli ...` invocation, parses it into argv, spawns the CLI without
a shell, and streams stdout/stderr/exit data back to the agent.

For example, the agent can discover the CLI surface through the endpoint first:

```bash
curl -N http://localhost:3322/api/cli \
  -H "Content-Type: application/json" \
  -d '{"command":"posthog-cli --help"}'
```

That single call gives the agent the same starting point a human gets in a
terminal: available commands, options, and follow-up help paths such as
`posthog-cli exp --help` or `posthog-cli exp query run --help`. The experiment is
whether this progressive discovery is enough for useful agent workflows without
pre-modeling every API capability as a typed tool.

This is the core experiment: can an agent use a CLI through a minimal HTTP
wrapper with progressive discovery, without needing a large typed integration
layer?

### Direct API Tools

The API approach exposes hand-written typed tools backed by the PostHog API,
such as project listing, insight/dashboard listing, and HogQL querying.

This is the "custom integration" baseline. It should usually be efficient at
runtime, but every useful capability has to be intentionally surfaced in code.

### MCP Tools

The MCP approach connects to the PostHog MCP server and exposes discovered
read-only tools to the agent.

This is the protocol/tooling baseline. It gives broad capability with less
custom integration code, but the tool schemas and discovery surface can add
prompt/token overhead.

## What The App Measures

The dashboard and eval scripts compare:

- Prompt tokens, completion tokens, and total tokens
- Latency
- Tool-call count
- Output size
- Final success/failure status
- Curated integration LOC for CLI/API/MCP
- Tool traces, including command/tool inputs and compact results

The UI is a chat-style benchmark surface: send one initial prompt to CLI, API,
MCP, or all three; then inspect each approach in its own tab with metrics and
tool traces.

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

CLI mode uses the installed `@posthog/cli` package from the app runtime
(`node_modules/.bin/posthog-cli`) when available and only falls back to a
`posthog-cli` binary on the server PATH if the local package is missing. MCP
mode runs through the installed `@modelcontextprotocol/sdk` package in the app's
Node runtime, defaults to `https://mcp.posthog.com/mcp`, and uses
`POSTHOG_MCP_AUTH_HEADER` when set, otherwise
`Bearer ${POSTHOG_PERSONAL_API_KEY}`.

The CLI and MCP packages intentionally use normal semver ranges so fresh installs
can pick up current CLI/MCP behavior. Run `npm update @posthog/cli
@modelcontextprotocol/sdk mcp-remote` before recording or rerunning the benchmark
if you want the latest available versions in the lockfile.

## Scripts

```bash
npm run dev
npm run build
npm run eval
npm run eval:realworld:smoke
npm run eval:realworld
npm run eval:stats
npm run lint
npm run test
```

Evals use Promptfoo against the app HTTP endpoint, not a separate eval-only
integration. Eval configs, Promptfoo state, and run artifacts all live under
`evals/`.

- `evals/posthog_smoke.yaml`: simple endpoint smoke suite.
- `evals/posthog_realworld.yaml`: real PostHog task suite with source-of-truth
  expectations in YAML.
- `evals/eval_runs/`: local Promptfoo JSON/HTML/CSV reports and summarized
  stats. This folder is ignored by git.

The real-world suite runs the same prompt against the CLI, API, and MCP modes by
posting to:

```http
POST http://localhost:3322/api/benchmark/run
```

with only the `approach` field changed.

## Architecture

- `src/app`: Next routes and pages.
- `src/features/benchmark`: dashboard, reducer, streaming client.
- `src/core/domain`: shared benchmark types.
- `src/core/application`: orchestration and metrics helpers.
- `src/core/ports`: adapter contracts.
- `src/infrastructure`: CLI, API, MCP, and AI SDK adapters.
- `src/config`: tasks, LOC values, env parsing, and theme metadata.

## Safety Notes

The CLI wrapper intentionally does not execute a shell. It rejects empty
commands, non-`posthog-cli` executables, shell operators, pipes, redirects,
backticks, `$()`, `&&`, and `;`. It also enforces timeout/output caps and
redacts common token/API-key patterns from CLI trace output.
