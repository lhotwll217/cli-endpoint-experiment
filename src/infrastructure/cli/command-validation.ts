const FORBIDDEN_SHELL_SYNTAX = /[\r\n;|&<>`]/;
const COMMAND_SUBSTITUTION = /\$\s*\(/;

export class CliCommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliCommandValidationError";
  }
}

export function splitCommandLine(input: string): string[] {
  const argv: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        argv.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += "\\";
  }

  if (quote) {
    throw new CliCommandValidationError("Command contains an unterminated quote.");
  }

  if (current.length > 0) {
    argv.push(current);
  }

  return argv;
}

export function parsePostHogCliCommand(command: string): string[] {
  const trimmed = command.trim();

  if (!trimmed) {
    throw new CliCommandValidationError("Command is required.");
  }

  if (FORBIDDEN_SHELL_SYNTAX.test(trimmed) || COMMAND_SUBSTITUTION.test(trimmed)) {
    throw new CliCommandValidationError(
      "Command contains shell syntax. Provide exactly one posthog-cli invocation.",
    );
  }

  const argv = splitCommandLine(trimmed);

  if (argv.length === 0) {
    throw new CliCommandValidationError("Command is required.");
  }

  if (argv[0] !== "posthog-cli") {
    throw new CliCommandValidationError("Only posthog-cli commands are allowed.");
  }

  return argv;
}
