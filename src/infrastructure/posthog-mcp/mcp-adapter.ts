import { randomUUID } from "node:crypto";
import { tool, jsonSchema, type ToolSet } from "ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { ServerEnv } from "@/config/env";
import type { PostHogIntegrationAdapter, TraceRecorder } from "@/core/ports/posthog-integration";

type McpTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

const READ_HINTS = ["list", "get", "retrieve", "query", "search", "read", "find", "inspect", "describe"];
const WRITE_HINTS = ["create", "update", "delete", "remove", "patch", "write", "set", "upsert"];

export class McpPostHogAdapter implements PostHogIntegrationAdapter {
  readonly approach = "mcp" as const;

  constructor(private readonly env: ServerEnv) {}

  async createTools(recordTrace: TraceRecorder): Promise<ToolSet> {
    const client = await this.connectClient();
    const listed = await client.listTools();
    const exposedTools = listed.tools.filter(isReadOnlyTool).slice(0, 24);
    const aiTools: ToolSet = {};

    for (const mcpTool of exposedTools) {
      const toolName = sanitizeToolName(mcpTool.name);
      aiTools[toolName] = tool({
        description:
          mcpTool.description ??
          `Call the PostHog MCP tool named ${mcpTool.name}. This benchmark exposes read-only MCP tools only.`,
        inputSchema: jsonSchema((mcpTool.inputSchema ?? { type: "object", properties: {} }) as JSONSchema7),
        execute: async (input) => {
          const started = Date.now();
          recordTrace({
            id: randomUUID(),
            at: new Date(started).toISOString(),
            approach: "mcp",
            phase: "tool-call",
            toolName,
            input,
          });

          try {
            const result = await client.callTool({
              name: mcpTool.name,
              arguments: input && typeof input === "object" ? (input as Record<string, unknown>) : {},
            });
            const compact = compactMcpResult(result);
            recordTrace({
              id: randomUUID(),
              at: new Date().toISOString(),
              approach: "mcp",
              phase: "tool-result",
              toolName,
              input,
              output: compact,
              durationMs: Date.now() - started,
            });
            return compact;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            recordTrace({
              id: randomUUID(),
              at: new Date().toISOString(),
              approach: "mcp",
              phase: "tool-error",
              toolName,
              input,
              durationMs: Date.now() - started,
              error: message,
            });
            throw error;
          }
        },
      });
    }

    if (Object.keys(aiTools).length === 0) {
      throw new Error("The PostHog MCP server did not expose any read-only tools.");
    }

    return aiTools;
  }

  private async connectClient(): Promise<Client> {
    const client = new Client({ name: "posthog-benchmark-demo", version: "0.1.0" });

    if (this.env.posthogMcpCommand) {
      const transport = new StdioClientTransport({
        command: this.env.posthogMcpCommand,
        args: this.env.posthogMcpArgs,
        env: process.env as Record<string, string>,
        stderr: "pipe",
      });
      await client.connect(transport);
      return client;
    }

    const headers: HeadersInit = this.env.posthogMcpAuthHeader
      ? { Authorization: this.env.posthogMcpAuthHeader }
      : {};
    const transport = new StreamableHTTPClientTransport(new URL(this.env.posthogMcpUrl), {
      requestInit: { headers },
    });
    await client.connect(transport);
    return client;
  }
}

function isReadOnlyTool(toolInfo: McpTool): boolean {
  if (toolInfo.annotations?.destructiveHint === true) {
    return false;
  }
  if (toolInfo.annotations?.readOnlyHint === true) {
    return true;
  }

  const haystack = `${toolInfo.name} ${toolInfo.description ?? ""}`.toLowerCase();
  if (WRITE_HINTS.some((hint) => haystack.includes(hint))) {
    return false;
  }

  return READ_HINTS.some((hint) => haystack.includes(hint));
}

function sanitizeToolName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return sanitized || "posthog_mcp_tool";
}

function compactMcpResult(result: unknown): unknown {
  const text = summarizeUnknown(result, 12_000);
  if (text.length > 12_000) {
    return `${text.slice(0, 12_000)}...`;
  }
  return JSON.parse(JSON.stringify(result ?? null));
}

function summarizeUnknown(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
