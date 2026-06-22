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

  const suiteStats = [];
  const approachStats = new Map();
  const allLatencies = [];
  let totalPass = 0;
  let totalFail = 0;
  let totalError = 0;

  for (const file of jsonFiles) {
    const data = readJson(join(folder, file));
    if (!data?.results) {
      continue;
    }

    const promptMetrics = data.results.prompts?.[0]?.metrics ?? {};
    const resultRows = data.results.results ?? [];
    const pass = resultRows.filter((result) => result.success).length;
    const error = resultRows.filter((result) => result.failureReason === "ERROR").length;
    const fail = resultRows.length - pass - error;
    totalPass += pass;
    totalFail += fail;
    totalError += error;

    suiteStats.push({
      name: file.replace(/\.json$/, ""),
      pass,
      fail,
      error,
      total: pass + fail + error,
      passRate: rate(pass, pass + fail + error),
      tokenUsage: promptMetrics.tokenUsage ?? {},
      namedScores: promptMetrics.namedScores ?? {},
    });

    for (const result of resultRows) {
      const latency = Number(result.latencyMs ?? result.response?.latencyMs ?? 0);
      if (latency > 0) {
        allLatencies.push(latency);
      }
      const approach = result.response?.metadata?.approach ?? result.provider?.id ?? "unknown";
      const current = approachStats.get(approach) ?? createApproachStats(approach);
      approachStats.set(approach, current);
      current.total += 1;
      if (result.success) current.pass += 1;
      else if (result.failureReason === "ERROR") current.error += 1;
      else current.fail += 1;
      current.latencies.push(latency);
      const metrics = result.response?.metadata?.metrics ?? {};
      current.promptTokens += Number(metrics.promptTokens ?? result.response?.tokenUsage?.prompt ?? 0);
      current.completionTokens += Number(metrics.completionTokens ?? result.response?.tokenUsage?.completion ?? 0);
      current.totalTokens += Number(metrics.totalTokens ?? result.response?.tokenUsage?.total ?? 0);
      current.toolCalls += Number(metrics.toolCalls ?? 0);
      current.outputBytes += Number(metrics.outputBytes ?? 0);
      current.loc = Number(metrics.loc ?? current.loc);
      current.systemPromptBytes += Number(metrics.systemPromptBytes ?? 0);
      current.toolPromptBytes += Number(metrics.toolPromptBytes ?? 0);
    }
  }

  const total = totalPass + totalFail + totalError;
  return {
    runFolder: basename(folder),
    generatedAt: new Date().toISOString(),
    metadata,
    git: {
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: git(["rev-parse", "--short", "HEAD"]),
    },
    summary: {
      suites: suiteStats.length,
      total,
      pass: totalPass,
      fail: totalFail,
      error: totalError,
      passRate: rate(totalPass, total),
    },
    latency: summarizeNumbers(allLatencies),
    approaches: [...approachStats.values()].map(finalizeApproachStats),
    suites: suiteStats,
  };
}

function createApproachStats(approach) {
  return {
    approach,
    total: 0,
    pass: 0,
    fail: 0,
    error: 0,
    latencies: [],
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    toolCalls: 0,
    outputBytes: 0,
    loc: 0,
    systemPromptBytes: 0,
    toolPromptBytes: 0,
  };
}

function finalizeApproachStats(stats) {
  return {
    approach: stats.approach,
    total: stats.total,
    pass: stats.pass,
    fail: stats.fail,
    error: stats.error,
    passRate: rate(stats.pass, stats.total),
    latency: summarizeNumbers(stats.latencies),
    tokens: {
      prompt: stats.promptTokens,
      completion: stats.completionTokens,
      total: stats.totalTokens,
      avgTotal: stats.total ? Math.round(stats.totalTokens / stats.total) : 0,
    },
    toolCalls: {
      total: stats.toolCalls,
      avg: stats.total ? round(stats.toolCalls / stats.total, 2) : 0,
    },
    outputBytes: stats.outputBytes,
    loc: stats.loc,
    promptBytes: {
      system: stats.systemPromptBytes,
      tool: stats.toolPromptBytes,
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
    summary: stats.summary,
    latency: stats.latency,
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
  console.log(`Pass rate: ${stats.summary.passRate}% (${stats.summary.pass}/${stats.summary.total})`);
  console.log(`Latency mean: ${stats.latency.meanMs ?? "N/A"}ms`);
  for (const approach of stats.approaches) {
    console.log(
      `${approach.approach}: pass ${approach.pass}/${approach.total}, tokens avg ${approach.tokens.avgTotal}, latency mean ${approach.latency.meanMs ?? "N/A"}ms, tools avg ${approach.toolCalls.avg}`,
    );
  }
}

function summarizeNumbers(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (clean.length === 0) {
    return {};
  }
  const sum = clean.reduce((acc, value) => acc + value, 0);
  return {
    count: clean.length,
    meanMs: round(sum / clean.length, 2),
    medianMs: round(clean[Math.floor(clean.length / 2)], 2),
    minMs: round(clean[0], 2),
    maxMs: round(clean[clean.length - 1], 2),
  };
}

function rate(count, total) {
  return total ? round((count / total) * 100, 2) : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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
