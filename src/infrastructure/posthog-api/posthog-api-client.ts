import type { ServerEnv } from "@/config/env";

export class PostHogApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostHogApiConfigurationError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

export class PostHogApiClient {
  constructor(private readonly env: ServerEnv) {}

  async listProjects(limit = 20): Promise<unknown> {
    const organizationId = this.require("POSTHOG_ORGANIZATION_ID", this.env.posthogOrganizationId);
    return this.request(`/api/organizations/${organizationId}/projects/`, {
      query: { limit },
    });
  }

  async queryHogQL(query: string): Promise<unknown> {
    const projectId = this.require("POSTHOG_PROJECT_ID", this.env.posthogProjectId);
    return this.request(`/api/projects/${projectId}/query/`, {
      method: "POST",
      body: {
        query: {
          kind: "HogQLQuery",
          query,
        },
      },
    });
  }

  async listInsights(limit = 20): Promise<unknown> {
    const environmentId = this.require(
      "POSTHOG_ENVIRONMENT_ID or POSTHOG_PROJECT_ID",
      this.env.posthogEnvironmentId,
    );
    return this.request(`/api/environments/${environmentId}/insights/`, {
      query: { limit },
    });
  }

  async listDashboards(limit = 20): Promise<unknown> {
    const environmentId = this.require(
      "POSTHOG_ENVIRONMENT_ID or POSTHOG_PROJECT_ID",
      this.env.posthogEnvironmentId,
    );
    return this.request(`/api/environments/${environmentId}/dashboards/`, {
      query: { limit },
    });
  }

  private async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const apiKey = this.require("POSTHOG_PERSONAL_API_KEY", this.env.posthogPersonalApiKey);
    const url = new URL(path, this.env.posthogHost);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });

    const text = await response.text();
    const parsed = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      throw new Error(
        `PostHog API ${response.status} ${response.statusText}: ${summarizeUnknown(parsed ?? text)}`,
      );
    }

    return compactUnknown(parsed);
  }

  private require(name: string, value: string | undefined): string {
    if (!value) {
      throw new PostHogApiConfigurationError(`${name} is required for direct API mode.`);
    }
    return value;
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function summarizeUnknown(value: unknown, maxLength = 900): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function compactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 25).map(compactUnknown);
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record)
      .map(([key, item]) => [key, isSensitiveKey(key) ? "[REDACTED]" : item] as const)
      .filter(([key]) => !["next", "previous"].includes(key))
      .slice(0, 40)
      .map(([key, item]) => [key, compactUnknown(item)]);
    return Object.fromEntries(entries);
  }

  if (typeof value === "string" && value.length > 4_000) {
    return `${value.slice(0, 4_000)}...`;
  }

  return value;
}

function isSensitiveKey(key: string): boolean {
  return /token|api[_-]?key|authorization|secret|password/i.test(key);
}
