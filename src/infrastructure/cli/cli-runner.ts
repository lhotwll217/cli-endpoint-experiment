import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parsePostHogCliCommand } from "@/infrastructure/cli/command-validation";
import {
  CLI_HELP_SKILL_ADDENDUM,
  CLI_SKILL_TEXT,
  isRootHelpCommand,
  isSkillCommand,
} from "@/infrastructure/cli/cli-skill";

export type CliStreamEvent =
  | {
      type: "start";
      command: string;
      argv: string[];
      at: string;
    }
  | {
      type: "stdout" | "stderr";
      chunk: string;
      at: string;
    }
  | {
      type: "exit";
      code: number | null;
      signal: NodeJS.Signals | null;
      durationMs: number;
      stdoutBytes: number;
      stderrBytes: number;
      at: string;
    }
  | {
      type: "error";
      message: string;
      at: string;
    };

export type CliExecutionResult = {
  id: string;
  command: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  truncated: boolean;
};

export type CliRunOptions = {
  timeoutMs: number;
  outputLimitBytes: number;
  env?: NodeJS.ProcessEnv;
};

type QueueState = {
  events: CliStreamEvent[];
  resolve?: () => void;
  done: boolean;
};

function push(queue: QueueState, event: CliStreamEvent) {
  queue.events.push(event);
  queue.resolve?.();
  queue.resolve = undefined;
}

export async function* runPostHogCliStream(
  command: string,
  options: CliRunOptions,
): AsyncGenerator<CliStreamEvent> {
  const argv = parsePostHogCliCommand(command);
  const started = Date.now();

  if (isSkillCommand(argv)) {
    yield { type: "start", command, argv, at: new Date(started).toISOString() };
    yield { type: "stdout", chunk: CLI_SKILL_TEXT, at: new Date().toISOString() };
    yield {
      type: "exit",
      code: 0,
      signal: null,
      durationMs: Date.now() - started,
      stdoutBytes: Buffer.byteLength(CLI_SKILL_TEXT),
      stderrBytes: 0,
      at: new Date().toISOString(),
    };
    return;
  }

  const queue: QueueState = { events: [], done: false };
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let overLimit = false;

  push(queue, { type: "start", command, argv, at: new Date(started).toISOString() });

  const child = spawn(resolvePostHogCliBinary(argv[0]), argv.slice(1), {
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timer = setTimeout(() => {
    push(queue, {
      type: "error",
      message: `Command timed out after ${options.timeoutMs}ms.`,
      at: new Date().toISOString(),
    });
    child.kill("SIGTERM");
  }, options.timeoutMs);

  child.stdout?.on("data", (buffer: Buffer) => {
    stdoutBytes += buffer.byteLength;
    if (stdoutBytes + stderrBytes > options.outputLimitBytes) {
      if (!overLimit) {
        overLimit = true;
        push(queue, {
          type: "error",
          message: `Command output exceeded ${options.outputLimitBytes} bytes.`,
          at: new Date().toISOString(),
        });
        child.kill("SIGTERM");
      }
      return;
    }
    push(queue, { type: "stdout", chunk: buffer.toString("utf8"), at: new Date().toISOString() });
  });

  child.stderr?.on("data", (buffer: Buffer) => {
    stderrBytes += buffer.byteLength;
    if (stdoutBytes + stderrBytes > options.outputLimitBytes) {
      if (!overLimit) {
        overLimit = true;
        push(queue, {
          type: "error",
          message: `Command output exceeded ${options.outputLimitBytes} bytes.`,
          at: new Date().toISOString(),
        });
        child.kill("SIGTERM");
      }
      return;
    }
    push(queue, { type: "stderr", chunk: buffer.toString("utf8"), at: new Date().toISOString() });
  });

  child.on("error", (error) => {
    push(queue, { type: "error", message: error.message, at: new Date().toISOString() });
  });

  child.on("close", (code, signal) => {
    clearTimeout(timer);
    push(queue, {
      type: "exit",
      code,
      signal,
      durationMs: Date.now() - started,
      stdoutBytes,
      stderrBytes,
      at: new Date().toISOString(),
    });
    queue.done = true;
    queue.resolve?.();
  });

  while (!queue.done || queue.events.length > 0) {
    if (queue.events.length === 0) {
      await new Promise<void>((resolve) => {
        queue.resolve = resolve;
      });
      continue;
    }

    const event = queue.events.shift();
    if (event) {
      // Advertise the skill meta-command in root help, per the framing: help
      // optionally lists a skill when usage instructions are high-value.
      if (event.type === "exit" && event.code === 0 && isRootHelpCommand(argv)) {
        yield { type: "stdout", chunk: CLI_HELP_SKILL_ADDENDUM, at: new Date().toISOString() };
      }
      yield event;
    }
  }
}

function resolvePostHogCliBinary(executable: string): string {
  const localBinary = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? `${executable}.cmd` : executable);
  return existsSync(localBinary) ? localBinary : executable;
}

export async function executePostHogCli(
  command: string,
  options: CliRunOptions,
): Promise<CliExecutionResult> {
  const id = randomUUID();
  let code: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let stdout = "";
  let stderr = "";
  let durationMs = 0;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let truncated = false;

  for await (const event of runPostHogCliStream(command, options)) {
    if (event.type === "stdout") {
      stdout += event.chunk;
    }
    if (event.type === "stderr") {
      stderr += event.chunk;
    }
    if (event.type === "error") {
      truncated ||= event.message.includes("exceeded");
      stderr += stderr ? `\n${event.message}` : event.message;
    }
    if (event.type === "exit") {
      code = event.code;
      signal = event.signal;
      durationMs = event.durationMs;
      stdoutBytes = event.stdoutBytes;
      stderrBytes = event.stderrBytes;
    }
  }

  return { id, command, code, signal, stdout, stderr, durationMs, stdoutBytes, stderrBytes, truncated };
}
