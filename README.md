# HTTP CLI: giving a remote server the ergonomics of a CLI

Agents are unusually good at driving CLIs: one string in, text out, and the
whole capability surface is discoverable progressively through `--help`. But a
CLI is a local artifact — it needs a binary installed, versioned, and
sandboxed next to the agent. MCP was designed for the remote case, and it pays
for that with tool-schema and discovery overhead in the prompt.

This repo explores the middle:

> What if a remote server exposed a CLI-designed interface over plain HTTP —
> one endpoint, one command string — so an agent gets CLI ergonomics without a
> local binary?

Per-capability authoring has to happen somewhere no matter what; for a CLI it
already happened when the CLI was written. The pattern here is about
**deployment and integration simplicity**: what the endpoint looks like, and
how an agent behaves when it drives one.

## The endpoint

The agent gets a single tool:

```ts
posthog_cli({ command: string })
```

It calls one internal endpoint, `POST /api/cli`, which validates a single
`posthog-cli ...` invocation, parses it into argv, executes it without a
shell, and streams stdout/stderr/exit data back:

```bash
curl -N http://localhost:3322/api/cli \
  -H "Content-Type: application/json" \
  -d '{"command":"posthog-cli --help"}'
```

That first call gives the agent the same starting point a human gets in a
terminal: available commands, options, and follow-up help paths such as
`posthog-cli exp --help` or `posthog-cli exp query run --help`. No capability
is pre-modeled as a typed tool; the agent discovers what it needs.

In this experiment the endpoint wraps the actual `posthog-cli` binary, because
the binary already exists and keeps the experiment faithful. That is an
implementation detail the agent cannot observe: a production server would
implement the same command grammar directly against its real API, and nothing
about the interface — or this benchmark — would change.

## The comparison

The demo races the same prompt across two surfaces, side by side:

- **HTTP CLI** — the one-string-tool endpoint described above.
- **MCP** — the PostHog MCP server's discovered read-only tools.

PostHog is the integration target because it genuinely has both surfaces (plus
a documented API), and the eval tasks run against real product analytics data.

These two are the fair comparison because they are the same genus: general
surfaces with runtime discovery. The CLI discovers via `--help` on demand;
MCP preloads discovered tool schemas. An earlier hand-written typed-tools arm
was removed: it carried a small curated subset of capabilities, so token
comparisons against a full discovered surface would have confounded leanness
with reduced capability breadth.

## The demo UI

One prompt box fans out to two chat panes (HTTP CLI left, MCP right) streaming
simultaneously. Each pane shows a live strip of tokens, tool calls, and
elapsed time, and every tool call renders as a collapsible card in the
conversation — collapsed it's the command/tool name with duration and output
size, expanded it's the full input and output. Watching the two discovery
styles diverge on the same prompt is the point.

## Evals

Evals use Promptfoo against the app's own HTTP endpoint (`POST
/api/benchmark/run`), not a separate eval-only integration, with only the
`approach` field changed per arm.

- `evals/posthog_smoke.yaml` — simple endpoint smoke suite.
- `evals/posthog_realworld.yaml` — real PostHog task suite. Each task's
  expected numbers live in `evals/ground_truth/*.md`, regenerated straight
  from PostHog by `npm run truth` (`scripts/generate-ground-truth.mjs`), so
  the rubric grades against auditable, reproducible data.
- `evals/eval_runs/` — local Promptfoo reports and stats (gitignored).

`npm run eval:realworld` runs each task once per arm by default; pass
`-- --repeat N` to add repeats when recording final numbers (agents are
stochastic, so repeats buy confidence at token cost). `npm run eval:stats`
then reports the headline number per arm: **cost of success** — median
tokens, latency, and tool calls over passing runs only, plus per-task
breakdowns.

Three of the tasks are designed to stress where the surfaces should diverge:
a multi-step drill-down (find the top blog URL, then break it down by
device), a weekly trend (date bucketing), and a full page inventory (larger
result sets). Their ground-truth files ship as `GROUND TRUTH PENDING` —
run `npm run truth` once with PostHog credentials before benchmarking them.

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
- `POSTHOG_ENVIRONMENT_ID`, or it falls back to `POSTHOG_PROJECT_ID`

CLI mode uses the installed `@posthog/cli` package from the app runtime
(`node_modules/.bin/posthog-cli`) when available and only falls back to a
`posthog-cli` binary on the server PATH if the local package is missing. MCP
mode runs through the installed `@modelcontextprotocol/sdk` package in the
app's Node runtime, defaults to `https://mcp.posthog.com/mcp`, and uses
`POSTHOG_MCP_AUTH_HEADER` when set, otherwise
`Bearer ${POSTHOG_PERSONAL_API_KEY}`.

The CLI and MCP packages intentionally use normal semver ranges so fresh
installs pick up current behavior. Run `npm update @posthog/cli
@modelcontextprotocol/sdk mcp-remote` before recording benchmark numbers.

## Scripts

```bash
npm run dev
npm run build
npm run truth                 # regenerate evals/ground_truth from PostHog
npm run eval                  # smoke suite
npm run eval:realworld        # full suite (add -- --repeat N for repeats)
npm run eval:realworld:smoke  # first task only, 1 repeat
npm run eval:stats            # cost-of-success report for the latest run
npm run lint
npm run test
```

## Architecture

- `src/app`: Next routes and pages.
- `src/features/benchmark`: race dashboard, reducer, streaming client.
- `src/core/domain`: shared benchmark types.
- `src/core/application`: orchestration and metrics helpers.
- `src/core/ports`: adapter contracts.
- `src/infrastructure`: CLI, MCP, and AI SDK adapters.
- `src/config`: env parsing and theme metadata.

## Safety notes

The CLI wrapper intentionally does not execute a shell. It rejects empty
commands, non-`posthog-cli` executables, shell operators, pipes, redirects,
backticks, `$()`, `&&`, and `;`. It also enforces timeout/output caps and
redacts common token/API-key patterns from CLI trace output.
