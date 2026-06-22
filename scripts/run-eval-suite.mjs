#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const config = args.config ?? "evals/posthog_realworld.yaml";
const label = safeName(
  args.label ?? (basename(config).replace(/^posthog_?/, "").replace(/\.ya?ml$/, "") || "eval"),
);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = resolve(repoRoot, "evals", "eval_runs", `${timestamp}_${label}`);
mkdirSync(runDir, { recursive: true });

const outputJson = join(runDir, `${label}.json`);
const outputHtml = join(runDir, `${label}.html`);
const outputCsv = join(runDir, `${label}.csv`);
const promptfooLog = join(runDir, "promptfoo.log");
const envFile = resolve(repoRoot, args.envFile ?? ".env.local");
const envValues = readEnvFile(envFile);
const maxConcurrency = String(args.maxConcurrency ?? "1");
const repeat = String(args.repeat ?? "1");

const command = [
  "promptfoo",
  "eval",
  "-c",
  config,
  "--repeat",
  repeat,
  "--no-cache",
  "--no-share",
  "--max-concurrency",
  maxConcurrency,
  "--output",
  outputJson,
  outputHtml,
  outputCsv,
  "--table",
];

if (existsSync(envFile)) {
  command.push("--env-file", envFile);
}
if (args.filterProviders) {
  command.push("--filter-providers", args.filterProviders);
}
if (args.filterFirstN) {
  command.push("--filter-first-n", String(args.filterFirstN));
}
if (args.filterPattern) {
  command.push("--filter-pattern", args.filterPattern);
}
if (args.grader) {
  command.push("--grader", args.grader);
}

const metadata = {
  timestamp: new Date().toISOString(),
  runFolder: basename(runDir),
  config,
  label,
  repeat: Number(repeat),
  maxConcurrency: Number(maxConcurrency),
  filterProviders: args.filterProviders ?? null,
  filterFirstN: args.filterFirstN ? Number(args.filterFirstN) : null,
  filterPattern: args.filterPattern ?? null,
  model: process.env.OPENAI_MODEL ?? envValues.OPENAI_MODEL ?? null,
  reasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? envValues.OPENAI_REASONING_EFFORT ?? null,
  envFile: existsSync(envFile) ? envFile : null,
};
writeFileSync(join(runDir, "run_metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);

const env = {
  ...process.env,
  PROMPTFOO_CONFIG_DIR: resolve(repoRoot, "evals", ".promptfoo-data"),
  PROMPTFOO_DISABLE_TELEMETRY: "1",
  PROMPTFOO_DISABLE_UPDATE: "1",
  PROMPTFOO_PASS_RATE_THRESHOLD: "0",
};

const result = spawnSync("npx", command, {
  cwd: repoRoot,
  env,
  encoding: "utf8",
});

writeFileSync(
  promptfooLog,
  [`$ npx ${command.join(" ")}`, "", result.stdout ?? "", result.stderr ?? ""].join("\n"),
);

if (result.status !== 0) {
  console.error(`Promptfoo failed. See ${promptfooLog}`);
  process.exit(result.status ?? 1);
}

console.log(`Eval run written to ${runDir}`);

if (args.stats !== "false") {
  const statsResult = spawnSync("node", ["scripts/generate-eval-stats.mjs", runDir, "--stats"], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (statsResult.status !== 0) {
    process.exit(statsResult.status ?? 1);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "eval";
}

function readEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const [key, ...rest] = line.split("=");
    values[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}
