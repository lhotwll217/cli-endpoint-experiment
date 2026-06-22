import type { BenchmarkTask } from "@/core/domain/benchmark";

export const benchmarkTasks: BenchmarkTask[] = [
  {
    id: "project-context",
    title: "Project context",
    prompt:
      "Find the current PostHog project or environment context, then summarize what data is available for analysis.",
  },
  {
    id: "recent-events",
    title: "Recent events",
    prompt:
      "Use PostHog to identify recent event names or event-like data sources and explain which look useful for a product analytics demo.",
  },
  {
    id: "insights-dashboards",
    title: "Insights and dashboards",
    prompt:
      "List the available insights and dashboards, then recommend one follow-up analytics question for a blog-post comparison.",
  },
  {
    id: "hogql-question",
    title: "HogQL question",
    prompt:
      "Run a small read-only HogQL query that helps understand product activity, and explain the result in two concise bullets.",
  },
];

export const defaultBenchmarkTask = benchmarkTasks[0];
