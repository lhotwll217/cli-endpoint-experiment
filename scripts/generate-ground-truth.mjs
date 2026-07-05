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

// Fixed, fully-elapsed windows so regeneration is deterministic.
const PAGEVIEW_WINDOW = { from: "2026-04-06", to: "2026-05-06" };
const PRODUCT_WINDOW = { from: "2026-06-15", to: "2026-07-04" };
const ADS_WINDOW = { from: "2026-06-01", to: "2026-06-30" };

const pageviewFilter = `event = '$pageview' AND toDate(timestamp) >= toDate('${PAGEVIEW_WINDOW.from}') AND toDate(timestamp) <= toDate('${PAGEVIEW_WINDOW.to}')`;
const productDateFilter = `toDate(timestamp) >= toDate('${PRODUCT_WINDOW.from}') AND toDate(timestamp) <= toDate('${PRODUCT_WINDOW.to}')`;
const adsDateFilter = `toDate(segments_date) >= toDate('${ADS_WINDOW.from}') AND toDate(segments_date) <= toDate('${ADS_WINDOW.to}')`;
const TOP_BLOG_URL_SUBQUERY = `(
      SELECT properties.$current_url
      FROM events
      WHERE ${pageviewFilter} AND (properties.$current_url LIKE '%/blog/%' OR properties.$current_url LIKE '%/blogs/%')
      GROUP BY properties.$current_url
      ORDER BY count() DESC
      LIMIT 1
    )`;

const TASKS = [
  {
    id: "marketing-top-pages",
    window: PAGEVIEW_WINDOW,
    intro: ["Ground truth from PostHog $pageview data for the same date window:"],
    queries: [
      {
        label: "Page paths ranked by pageviews",
        format: (rows) => rows.map(([path, count], i) => `- #${i + 1} ${path} = ${count} pageviews`),
        hogql: `
          SELECT properties.$pathname AS path, count() AS pageviews
          FROM events
          WHERE ${pageviewFilter}
          GROUP BY path ORDER BY pageviews DESC, path ASC LIMIT 20`,
      },
    ],
  },
  {
    id: "blog-device-drilldown",
    window: PAGEVIEW_WINDOW,
    intro: ["Ground truth from PostHog pageview data for the same date window:"],
    queries: [
      {
        label: "Top blog URL by pageviews",
        format: (rows) => rows.map(([url, count]) => `- Top blog URL: ${url} = ${count} pageviews`),
        hogql: `
          SELECT properties.$current_url AS url, count() AS pageviews
          FROM events
          WHERE ${pageviewFilter} AND (properties.$current_url LIKE '%/blog/%' OR properties.$current_url LIKE '%/blogs/%')
          GROUP BY url ORDER BY pageviews DESC, url ASC LIMIT 1`,
      },
      {
        label: "Device breakdown for that URL",
        format: (rows) => rows.map(([device, count]) => `- ${device ?? "unknown"} = ${count} pageviews`),
        hogql: `
          SELECT properties.$device_type AS device_type, count() AS pageviews
          FROM events
          WHERE ${pageviewFilter} AND properties.$current_url = ${TOP_BLOG_URL_SUBQUERY}
          GROUP BY device_type ORDER BY pageviews DESC`,
      },
    ],
  },
  {
    id: "all-pages-inventory",
    window: PAGEVIEW_WINDOW,
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
          WHERE ${pageviewFilter}
          GROUP BY path ORDER BY pageviews DESC, path ASC LIMIT 200`,
      },
    ],
  },
  {
    id: "product-usage-events",
    window: PRODUCT_WINDOW,
    intro: [
      "Ground truth from PostHog event data for the same date window.",
      "Extract-to-sheet product usage events with counts and unique people:",
    ],
    queries: [
      {
        label: "Product usage events",
        format: (rows) =>
          rows.map(([event, count, people]) => `- ${event} = ${count} events, ${people} unique people`),
        hogql: `
          SELECT event, count() AS total, count(DISTINCT person_id) AS unique_people
          FROM events
          WHERE ${productDateFilter} AND event IN (
            'extraction_started','extraction_completed',
            'sheet_insert_started','sheet_insert_completed',
            'credits_used','auth_signed_in',
            'checkout_started','checkout_session_started','checkout_session_created','checkout_redirected'
          )
          GROUP BY event ORDER BY total DESC, event ASC`,
      },
    ],
  },
  {
    id: "oauth-token-pipeline",
    window: PRODUCT_WINDOW,
    intro: [
      "Ground truth from PostHog event data for the same date window.",
      "Google OAuth token pipeline event counts:",
    ],
    queries: [
      {
        label: "google_oauth_tokens_* events",
        format: (rows) => {
          const lines = rows.map(([event, count]) => `- ${event} = ${count} events`);
          const byName = Object.fromEntries(rows.map(([event, count]) => [event, Number(count)]));
          const stored = byName.google_oauth_tokens_stored ?? 0;
          const started = byName.google_oauth_tokens_store_started ?? 0;
          if (stored > started) {
            lines.push(
              `- Notable: tokens_stored (${stored}) far exceeds store_started (${started}), so most stores happen outside the started/completed instrumentation.`,
            );
          }
          return lines;
        },
        hogql: `
          SELECT event, count() AS total
          FROM events
          WHERE ${productDateFilter} AND event LIKE 'google_oauth_tokens%'
          GROUP BY event ORDER BY total DESC, event ASC`,
      },
    ],
  },
  {
    id: "trial-credits-batch-health",
    window: PRODUCT_WINDOW,
    intro: [
      "Ground truth from PostHog event data for the same date window.",
      "Trial credits batch job health:",
    ],
    queries: [
      {
        label: "Batch and grant event counts",
        format: (rows) => rows.map(([event, count, days]) => `- ${event} = ${count} events across ${days} distinct days`),
        hogql: `
          SELECT event, count() AS total, count(DISTINCT toDate(timestamp)) AS active_days
          FROM events
          WHERE ${productDateFilter} AND (event LIKE 'trial_credits%')
          GROUP BY event ORDER BY total DESC, event ASC`,
      },
    ],
  },
  {
    id: "ads-campaign-overview",
    window: ADS_WINDOW,
    intro: [
      "Ground truth from the Google Ads data warehouse table",
      "google_adsgoogleads_campaign_stats for the same date window",
      "(cost = metrics_cost_micros / 1,000,000; CTR = clicks / impressions):",
    ],
    queries: [
      {
        label: "Campaign totals for the window",
        format: (rows) =>
          rows.map(
            ([name, clicks, impressions, cost, ctr]) =>
              `- ${name}: ${clicks} clicks, ${impressions} impressions, $${cost} spend, ${ctr}% CTR`,
          ),
        hogql: `
          SELECT campaign_name,
                 sum(metrics_clicks) AS clicks,
                 sum(metrics_impressions) AS impressions,
                 round(sum(metrics_cost_micros) / 1000000, 2) AS cost,
                 round(sum(metrics_clicks) / sum(metrics_impressions) * 100, 2) AS ctr
          FROM google_adsgoogleads_campaign_stats
          WHERE ${adsDateFilter}
          GROUP BY campaign_name ORDER BY clicks DESC`,
      },
    ],
  },
  {
    id: "ads-clicks-vs-pageviews-weekly",
    window: ADS_WINDOW,
    intro: [
      "Ground truth comparing weekly Google Ads clicks (warehouse table",
      "google_adsgoogleads_campaign_stats) with weekly website $pageview events,",
      "weeks starting Monday, for the same date window:",
    ],
    queries: [
      {
        label: "Weekly ads clicks",
        format: (rows) => rows.map(([week, clicks]) => `- ads clicks, week of ${String(week).slice(0, 10)} = ${clicks}`),
        hogql: `
          SELECT toStartOfWeek(toDate(segments_date), 1) AS week, sum(metrics_clicks) AS clicks
          FROM google_adsgoogleads_campaign_stats
          WHERE ${adsDateFilter}
          GROUP BY week ORDER BY week ASC`,
      },
      {
        label: "Weekly pageviews",
        format: (rows) => rows.map(([week, count]) => `- pageviews, week of ${String(week).slice(0, 10)} = ${count}`),
        hogql: `
          SELECT toStartOfWeek(timestamp, 1) AS week, count() AS pageviews
          FROM events
          WHERE event = '$pageview' AND toDate(timestamp) >= toDate('${ADS_WINDOW.from}') AND toDate(timestamp) <= toDate('${ADS_WINDOW.to}')
          GROUP BY week ORDER BY week ASC`,
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
    `<!-- Window: ${task.window.from} .. ${task.window.to} | Host: ${host} | Environment: ${environmentId} -->`,
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
