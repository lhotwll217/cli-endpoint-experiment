#!/usr/bin/env node
// Regenerates evals/ground_truth/*.md from live PostHog data so every number
// the rubric grades against is auditable and reproducible.
//
// Usage: npm run truth [-- --only <task-id>] [--env-file .env.local]
// Requires POSTHOG_PERSONAL_API_KEY and POSTHOG_ENVIRONMENT_ID (or
// POSTHOG_PROJECT_ID) in the environment or the env file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const truthDir = join(repoRoot, "evals", "ground_truth");

const WINDOW = { from: "2026-04-06", to: "2026-05-06" };
const WINDOW_FILTER = `event = '$pageview' AND toDate(timestamp) >= toDate('${WINDOW.from}') AND toDate(timestamp) <= toDate('${WINDOW.to}')`;
const DATE_FILTER = `toDate(timestamp) >= toDate('${WINDOW.from}') AND toDate(timestamp) <= toDate('${WINDOW.to}')`;
const GENERIC_EVENTS = "'$pageview','$autocapture','$pageleave','$identify','$set','$feature_flag_called','$web_vitals'";
const TOP_BLOG_URL_SUBQUERY = `(
      SELECT properties.$current_url
      FROM events
      WHERE ${WINDOW_FILTER} AND (properties.$current_url LIKE '%/blog/%' OR properties.$current_url LIKE '%/blogs/%')
      GROUP BY properties.$current_url
      ORDER BY count() DESC
      LIMIT 1
    )`;

const TASKS = [
  {
    id: "marketing-blog-top-pages",
    intro: [
      "Ground truth from PostHog pageview data for the same date window:",
      "- Event: $pageview",
      "- Property: properties.$current_url",
      "- URL filter: contains /blog/ or /blogs/",
    ],
    queries: [
      {
        label: "Blog URLs ranked by pageviews",
        format: (rows) => rows.map(([url, count], i) => `- #${i + 1} ${url} = ${count} pageviews`),
        hogql: `
          SELECT properties.$current_url AS url, count() AS pageviews
          FROM events
          WHERE ${WINDOW_FILTER} AND (properties.$current_url LIKE '%/blog/%' OR properties.$current_url LIKE '%/blogs/%')
          GROUP BY url ORDER BY pageviews DESC, url ASC LIMIT 20`,
      },
    ],
  },
  {
    id: "marketing-top-pages",
    intro: ["Ground truth from PostHog $pageview data for the same date window:"],
    queries: [
      {
        label: "Page paths ranked by pageviews",
        format: (rows) => rows.map(([path, count], i) => `- #${i + 1} ${path} = ${count} pageviews`),
        hogql: `
          SELECT properties.$pathname AS path, count() AS pageviews
          FROM events
          WHERE ${WINDOW_FILTER}
          GROUP BY path ORDER BY pageviews DESC, path ASC LIMIT 20`,
      },
    ],
  },
  {
    id: "app-custom-events",
    intro: [
      "Ground truth from PostHog event data for the same date window, excluding",
      `${GENERIC_EVENTS.replaceAll("'", "")}:`,
    ],
    queries: [
      {
        label: "Non-generic events with counts",
        format: (rows) => rows.map(([event, count]) => `- ${event} = ${count} events`),
        hogql: `
          SELECT event, count() AS total
          FROM events
          WHERE ${DATE_FILTER} AND event NOT IN (${GENERIC_EVENTS})
          GROUP BY event ORDER BY total DESC, event ASC LIMIT 50`,
      },
    ],
  },
  {
    id: "activation-event-count",
    intro: ["Ground truth from PostHog event data for the same date window:"],
    queries: [
      {
        label: "Signup/activation/agent/workflow events",
        format: (rows) =>
          rows.length === 0
            ? ["- No matching signup/activation/agent/workflow events found."]
            : rows.map(([event, count, people]) => `- ${event} = ${count} events, ${people} unique people`),
        hogql: `
          SELECT event, count() AS total, count(DISTINCT person_id) AS unique_people
          FROM events
          WHERE ${DATE_FILTER} AND (
            event ILIKE '%signup%' OR event ILIKE '%sign_up%' OR event ILIKE '%activation%'
            OR event ILIKE '%agent%' OR event ILIKE '%workflow%'
          )
          GROUP BY event ORDER BY total DESC, event ASC LIMIT 50`,
      },
    ],
  },
  {
    id: "blog-device-drilldown",
    intro: ["Ground truth from PostHog pageview data for the same date window:"],
    queries: [
      {
        label: "Top blog URL by pageviews",
        format: (rows) => rows.map(([url, count]) => `- Top blog URL: ${url} = ${count} pageviews`),
        hogql: `
          SELECT properties.$current_url AS url, count() AS pageviews
          FROM events
          WHERE ${WINDOW_FILTER} AND (properties.$current_url LIKE '%/blog/%' OR properties.$current_url LIKE '%/blogs/%')
          GROUP BY url ORDER BY pageviews DESC, url ASC LIMIT 1`,
      },
      {
        label: "Device breakdown for that URL",
        format: (rows) => rows.map(([device, count]) => `- ${device ?? "unknown"} = ${count} pageviews`),
        hogql: `
          SELECT properties.$device_type AS device_type, count() AS pageviews
          FROM events
          WHERE ${WINDOW_FILTER} AND properties.$current_url = ${TOP_BLOG_URL_SUBQUERY}
          GROUP BY device_type ORDER BY pageviews DESC`,
      },
    ],
  },
  {
    id: "weekly-pageview-trend",
    intro: ["Ground truth from PostHog $pageview data, weeks starting Monday:"],
    queries: [
      {
        label: "Weekly pageview totals",
        format: (rows) => {
          const lines = rows.map(([week, count]) => `- week of ${String(week).slice(0, 10)} = ${count} pageviews`);
          if (rows.length >= 2) {
            const first = Number(rows[0][1]);
            const last = Number(rows[rows.length - 1][1]);
            const direction = last > first * 1.1 ? "up" : last < first * 0.9 ? "down" : "roughly flat";
            lines.push(`- Trend from first to last week: ${direction}`);
          }
          return lines;
        },
        hogql: `
          SELECT toStartOfWeek(timestamp, 1) AS week, count() AS pageviews
          FROM events
          WHERE ${WINDOW_FILTER}
          GROUP BY week ORDER BY week ASC`,
      },
    ],
  },
  {
    id: "all-pages-inventory",
    intro: ["Ground truth from PostHog $pageview data — every distinct page path with counts:"],
    queries: [
      {
        label: "All page paths with pageview counts",
        format: (rows) => [
          `- Distinct paths: ${rows.length}`,
          ...rows.map(([path, count], i) => `- #${i + 1} ${path} = ${count} pageviews`),
        ],
        hogql: `
          SELECT properties.$pathname AS path, count() AS pageviews
          FROM events
          WHERE ${WINDOW_FILTER}
          GROUP BY path ORDER BY pageviews DESC, path ASC LIMIT 200`,
      },
    ],
  },
];

const args = parseArgs(process.argv.slice(2));
loadEnvFile(resolve(repoRoot, args.envFile ?? ".env.local"));

const host = (process.env.POSTHOG_HOST ?? "https://us.posthog.com").replace(/\/$/, "");
const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
const environmentId = process.env.POSTHOG_ENVIRONMENT_ID ?? process.env.POSTHOG_PROJECT_ID;

if (!apiKey || !environmentId) {
  console.error(
    "Missing POSTHOG_PERSONAL_API_KEY and/or POSTHOG_ENVIRONMENT_ID (or POSTHOG_PROJECT_ID).\n" +
      "Set them in the environment or .env.local, then re-run `npm run truth`.",
  );
  process.exit(1);
}

mkdirSync(truthDir, { recursive: true });
const selected = args.only ? TASKS.filter((task) => task.id === args.only) : TASKS;
if (selected.length === 0) {
  console.error(`Unknown task id "${args.only}". Known: ${TASKS.map((task) => task.id).join(", ")}`);
  process.exit(1);
}

for (const task of selected) {
  const sections = [];
  for (const query of task.queries) {
    const rows = await runHogql(query.hogql);
    sections.push(query.format(rows).join("\n"));
  }

  const content = [
    `<!-- Generated by scripts/generate-ground-truth.mjs at ${new Date().toISOString()} -->`,
    `<!-- Window: ${WINDOW.from} .. ${WINDOW.to} | Host: ${host} | Environment: ${environmentId} -->`,
    ...task.queries.map((query) => `<!-- Query (${query.label}): ${query.hogql.replace(/\s+/g, " ").trim()} -->`),
    ...task.intro,
    ...sections,
    "",
  ].join("\n");

  const filePath = join(truthDir, `${task.id}.md`);
  writeFileSync(filePath, content);
  console.log(`Wrote ${filePath}`);
}

async function runHogql(query) {
  const response = await fetch(`${host}/api/environments/${environmentId}/query/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PostHog query failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = await response.json();
  return data.results ?? [];
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

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const [key, ...rest] = line.split("=");
    const name = key.trim();
    if (!(name in process.env)) {
      process.env[name] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  }
}
