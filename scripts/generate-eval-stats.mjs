#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const folderArg = args.find((arg) => !arg.startsWith("--"));
const writeStatsLog = args.includes("--stats");
const runDir = folderArg ? resolve(repoRoot, folderArg) : findLatestRunDir();

if (!runDir || !existsSync(runDir)) {
  console.error("No eval run folder found.");
  process.exit(1);
}

const stats = generateStats(runDir);
const outputPath = join(runDir, "global_results.json");
writeFileSync(outputPath, `${JSON.stringify(stats, null, 2)}\n`);

if (writeStatsLog) {
  const statsLogPath = resolve(repoRoot, "evals", "eval_runs", "eval_stat_log.json");
  prependStatsLog(statsLogPath, buildStatsLogEntry(stats));
}

printSummary(stats);

function findLatestRunDir() {
  const runsDir = resolve(repoRoot, "evals", "eval_runs");
  if (!existsSync(runsDir)) {
    return null;
  }
  const dirs = readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(runsDir, entry.name))
    .sort()
    .reverse();
  return dirs[0] ?? null;
}

function generateStats(folder) {
  const metadata = readJson(join(folder, "run_metadata.json")) ?? {};
  const jsonFiles = readdirSync(folder)
    .filter((file) => file.endsWith(".json"))
    .filter((file) => !["global_results.json", "run_metadata.json"].includes(file));

  // One record per individual run (task x approach x repeat).
  const records = [];

  for (const file of jsonFiles) {
    const data = readJson(join(folder, file));
    if (!data?.results) {
      continue;
    }

    for (const result of data.results.results ?? []) {
      const metrics = result.response?.metadata?.metrics ?? {};
      records.push({
        task: taskLabel(result),
        approach: result.response?.metadata?.approach ?? result.provider?.label ?? result.provider?.id ?? "unknown",
        success: Boolean(result.success),
        errored: result.failureReason === "ERROR",
        latencyMs: firstPositive(metrics.latencyMs, result.latencyMs, result.response?.latencyMs),
        promptTokens: firstPositive(metrics.promptTokens, result.response?.tokenUsage?.prompt),
        completionTokens: firstPositive(metrics.completionTokens, result.response?.tokenUsage?.completion),
        totalTokens: firstPositive(metrics.totalTokens, result.response?.tokenUsage?.total),
        toolCalls: Number(metrics.toolCalls ?? 0),
        outputBytes: Number(metrics.outputBytes ?? 0),
      });
    }
  }

  const pass = records.filter((record) => record.success).length;
  const error = records.filter((record) => record.errored).length;
  const fail = records.length - pass - error;

  return {
    runFolder: basename(folder),
    generatedAt: new Date().toISOString(),
    metadata,
    git: {
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: git(["rev-parse", "--short", "HEAD"]),
    },
    summary: {
      runs: records.length,
      pass,
      fail,
      error,
      passRate: rate(pass, records.length),
    },
    approaches: groupStats(records, (record) => record.approach).map(([approach, group]) => ({
      approach,
      ...summarizeGroup(group),
    })),
    tasks: groupStats(records, (record) => `${record.task}::${record.approach}`).map(([key, group]) => {
      const [task, approach] = key.split("::");
      return { task, approach, ...summarizeGroup(group) };
    }),
  };
}

function taskLabel(result) {
  return (
    result.testCase?.description ??
    result.description ??
    result.testCase?.metadata?.prompt_id ??
    truncate(String(result.testCase?.vars?.prompt ?? result.vars?.prompt ?? "unknown"), 60)
  );
}

function groupStats(records, keyFn) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// The headline comparison is cost-of-success: what a run spends when it
// actually answers correctly. Failed runs are counted but not averaged in.
function summarizeGroup(group) {
  const passed = group.filter((record) => record.success);
  return {
    runs: group.length,
    pass: passed.length,
    fail: group.filter((record) => !record.success && !record.errored).length,
    error: group.filter((record) => record.errored).length,
    passRate: rate(passed.length, group.length),
    onSuccess: {
      totalTokens: distribution(passed.map((record) => record.totalTokens)),
      promptTokens: distribution(passed.map((record) => record.promptTokens)),
      completionTokens: distribution(passed.map((record) => record.completionTokens)),
      latencyMs: distribution(passed.map((record) => record.latencyMs)),
      toolCalls: distribution(passed.map((record) => record.toolCalls)),
      outputBytes: distribution(passed.map((record) => record.outputBytes)),
    },
  };
}

function buildStatsLogEntry(stats) {
  return {
    timestamp: stats.generatedAt,
    runFolder: stats.runFolder,
    branch: stats.git.branch,
    commit: stats.git.commit,
    model: stats.metadata.model,
    reasoningEffort: stats.metadata.reasoningEffort,
    repeat: stats.metadata.repeat,
    summary: stats.summary,
    approaches: stats.approaches,
  };
}

function prependStatsLog(path, entry) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const existing = readJson(path);
  const entries = Array.isArray(existing) ? existing : existing ? [existing] : [];
  writeFileSync(path, `${JSON.stringify([entry, ...entries], null, 2)}\n`);
}

function printSummary(stats) {
  console.log("\nEvaluation stats");
  console.log(`Run: ${stats.runFolder}`);
  console.log(`Pass rate: ${stats.summary.passRate}% (${stats.summary.pass}/${stats.summary.runs} runs)`);
  console.log("\nCost of success (median over passing runs):");
  for (const approach of stats.approaches) {
    const success = approach.onSuccess;
    console.log(
      `  ${approach.approach}: pass ${approach.pass}/${approach.runs} (${approach.passRate}%), ` +
        `tokens ${success.totalTokens.median ?? "N/A"}, ` +
        `latency ${success.latencyMs.median ?? "N/A"}ms, ` +
        `tools ${success.toolCalls.median ?? "N/A"}`,
    );
  }
  console.log("\nPer task:");
  for (const task of stats.tasks) {
    console.log(
      `  ${task.task} [${task.approach}]: pass ${task.pass}/${task.runs}, ` +
        `tokens ${task.onSuccess.totalTokens.median ?? "N/A"}, latency ${task.onSuccess.latencyMs.median ?? "N/A"}ms`,
    );
  }
}

function distribution(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (clean.length === 0) {
    return {};
  }
  const sum = clean.reduce((acc, value) => acc + value, 0);
  return {
    count: clean.length,
    mean: round(sum / clean.length, 2),
    median: round(median(clean), 2),
    min: round(clean[0], 2),
    max: round(clean[clean.length - 1], 2),
  };
}

function median(sortedValues) {
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}

function firstPositive(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return 0;
}

function rate(count, total) {
  return total ? round((count / total) * 100, 2) : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function truncate(value, limit) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function readJson(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
