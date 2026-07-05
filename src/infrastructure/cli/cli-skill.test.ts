import { describe, expect, it } from "vitest";
import { executePostHogCli } from "@/infrastructure/cli/cli-runner";
import { CLI_SKILL_TEXT, isRootHelpCommand, isSkillCommand } from "@/infrastructure/cli/cli-skill";

const options = { timeoutMs: 5_000, outputLimitBytes: 100_000 };

describe("posthog-cli skill meta-command", () => {
  it("serves the skill text without spawning the binary", async () => {
    const result = await executePostHogCli("posthog-cli skill", options);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(CLI_SKILL_TEXT);
    expect(result.stderr).toBe("");
    expect(result.stdoutBytes).toBeGreaterThan(0);
  });

  it("keeps the skill text within a progressive-disclosure budget", () => {
    // The guide is the optional rung on the --help ladder; it must stay far
    // cheaper than the schema payloads it replaces.
    expect(CLI_SKILL_TEXT.length).toBeLessThan(4_000);
  });

  it("detects skill and root-help invocations precisely", () => {
    expect(isSkillCommand(["posthog-cli", "skill"])).toBe(true);
    expect(isSkillCommand(["posthog-cli", "skill", "extra"])).toBe(false);
    expect(isRootHelpCommand(["posthog-cli", "--help"])).toBe(true);
    expect(isRootHelpCommand(["posthog-cli", "help"])).toBe(true);
    expect(isRootHelpCommand(["posthog-cli", "exp", "--help"])).toBe(false);
  });
});
