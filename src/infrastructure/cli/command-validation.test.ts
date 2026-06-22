import { describe, expect, it } from "vitest";
import { parsePostHogCliCommand } from "@/infrastructure/cli/command-validation";

describe("parsePostHogCliCommand", () => {
  it("accepts one posthog-cli invocation", () => {
    expect(parsePostHogCliCommand('posthog-cli query "select 1"')).toEqual([
      "posthog-cli",
      "query",
      "select 1",
    ]);
  });

  it("rejects empty commands", () => {
    expect(() => parsePostHogCliCommand("   ")).toThrow("Command is required");
  });

  it("rejects non-PostHog executables", () => {
    expect(() => parsePostHogCliCommand("node --version")).toThrow("Only posthog-cli");
  });

  it("rejects shell control syntax", () => {
    expect(() => parsePostHogCliCommand("posthog-cli --help && whoami")).toThrow("shell syntax");
    expect(() => parsePostHogCliCommand("posthog-cli --help | cat")).toThrow("shell syntax");
    expect(() => parsePostHogCliCommand("posthog-cli --help; whoami")).toThrow("shell syntax");
  });

  it("allows PostHog-style dollar-prefixed property names without command substitution", () => {
    expect(parsePostHogCliCommand("posthog-cli query select properties.$current_url from events")).toContain(
      "properties.$current_url",
    );
    expect(() => parsePostHogCliCommand("posthog-cli query $(whoami)")).toThrow("shell syntax");
  });
});
