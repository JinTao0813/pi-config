const MAX_SESSION_NAME_LENGTH = 48;
const MAX_SUBSESSION_SUFFIX_LENGTH = 24;
const MAX_ERROR_DIAGNOSTIC_CHARS = 8_192;

const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "--action-policy",
  "--allowed-domains",
  "--args",
  "--cdp",
  "--color-scheme",
  "--config",
  "--confirm-actions",
  "--device",
  "--download-path",
  "--enable",
  "--engine",
  "--executable-path",
  "--extension",
  "--headers",
  "--hide-scrollbars",
  "--idle-timeout",
  "--init-script",
  "--max-output",
  "--model",
  "--profile",
  "--provider",
  "-p",
  "--proxy",
  "--proxy-bypass",
  "--restore-check-fn",
  "--restore-check-text",
  "--restore-check-url",
  "--restore-save",
  "--screenshot-dir",
  "--screenshot-format",
  "--screenshot-quality",
  "--session-name",
  "--state",
  "--user-agent",
]);

const GLOBAL_BOOLEAN_OPTIONS = new Set([
  "--allow-file-access",
  "--annotate",
  "--auto-connect",
  "--confirm-interactive",
  "--content-boundaries",
  "--debug",
  "--headed",
  "--ignore-https-errors",
  "--json",
  "--no-auto-dialog",
  "--quiet",
  "-q",
  "--verbose",
  "-v",
  "--webgpu",
]);

const COMMANDS = new Set([
  "a11y", "back", "chat", "check", "click", "clipboard", "close", "connect", "cookies",
  "dashboard", "dblclick", "dialog", "download", "drag", "errors", "eval", "find", "focus",
  "forward", "get", "highlight", "hover", "install", "is", "keyboard", "logs", "mcp", "mouse",
  "network", "open", "pdf", "plugin", "press", "profiles", "react", "read", "reload", "screenshot",
  "scroll", "scrollintoview", "select", "session", "set", "skills", "snapshot", "state", "storage",
  "stream", "tab", "tabs", "trace", "type", "uncheck", "upgrade", "upload", "vitals", "wait",
]);

export interface PreparedCommand {
  action: string;
  argv: string[];
  sessionName: string;
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function splitCommand(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let argumentStarted = false;

  for (const character of input) {
    if (escaped) {
      current += character;
      argumentStarted = true;
      escaped = false;
      continue;
    }

    if (character === "\\" && quote !== "'") {
      escaped = true;
      argumentStarted = true;
      continue;
    }

    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      argumentStarted = true;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      argumentStarted = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (argumentStarted) {
        args.push(current);
        current = "";
        argumentStarted = false;
      }
      continue;
    }

    current += character;
    argumentStarted = true;
  }

  if (quote) throw new Error(`Unclosed quote: ${quote}`);
  if (escaped) current += "\\";
  if (argumentStarted) args.push(current);
  return args;
}

export function deriveSessionName(sessionId: string): string {
  const safeId = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "session";
  return `pi-${safeId}`.slice(0, MAX_SESSION_NAME_LENGTH);
}

function ownedSessionName(baseSessionName: string, suffix?: string): string {
  if (!suffix) return baseSessionName;
  if (
    suffix.length > MAX_SUBSESSION_SUFFIX_LENGTH
    || !/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/.test(suffix)
  ) {
    throw new Error(
      `Invalid browser session suffix. Use 1-${MAX_SUBSESSION_SUFFIX_LENGTH} letters, numbers, _ or -; start and end with a letter or number.`,
    );
  }
  return `${baseSessionName}-${suffix.toLowerCase()}`.slice(0, MAX_SESSION_NAME_LENGTH + MAX_SUBSESSION_SUFFIX_LENGTH + 1);
}

function optionName(token: string): string {
  return token.split("=", 1)[0] ?? token;
}

function findActionIndex(args: string[]): number {
  for (let index = 0; index < args.length;) {
    const token = args[index]!;
    if (!token.startsWith("-")) return index;

    const name = optionName(token);
    if (token.includes("=")) {
      index += 1;
    } else if (GLOBAL_OPTIONS_WITH_VALUE.has(name)) {
      index += 2;
    } else if (name === "--restore") {
      const next = args[index + 1];
      index += next && !next.startsWith("-") && !COMMANDS.has(next.toLowerCase()) ? 2 : 1;
    } else if (GLOBAL_BOOLEAN_OPTIONS.has(name)) {
      const next = args[index + 1];
      index += next === "true" || next === "false" ? 2 : 1;
    } else {
      index += 1;
    }
  }
  return -1;
}

export function prepareCommand(command: string, baseSessionName: string, suffix?: string): PreparedCommand {
  const args = splitCommand(command);
  if (args.some((arg) => optionName(arg) === "--session")) {
    throw new Error("Browser session options are wrapper-owned; use the browser tool's session field instead of --session.");
  }
  if (args.some((arg) => optionName(arg) === "--namespace")) {
    throw new Error("The --namespace option is not allowed because it can escape wrapper-owned cleanup.");
  }

  const actionIndex = findActionIndex(args);
  if (actionIndex < 0) throw new Error("Missing browser command.");
  const action = args[actionIndex]!.toLowerCase();
  const actionArgs = args.slice(actionIndex + 1);
  if (action === "close" && actionArgs.some((arg) => optionName(arg) === "--all")) {
    throw new Error("browser close --all is blocked because it can close other Pi sessions.");
  }
  if (action === "install" || action === "upgrade") {
    throw new Error(`browser ${action} is user-initiated only. Run /browser-install instead.`);
  }
  if (action === "doctor" && actionArgs.some((arg) => optionName(arg) === "--fix")) {
    throw new Error("browser doctor --fix is user-initiated only. Run /browser-doctor without mutation.");
  }

  const sessionName = ownedSessionName(baseSessionName, suffix);
  return {
    action,
    argv: [...args.slice(0, actionIndex), "--session", sessionName, ...args.slice(actionIndex)],
    sessionName,
  };
}

export function screenshotPath(output: string): string | undefined {
  const candidates = [output.trim(), ...output.trim().split(/\r?\n/).reverse()];
  for (const candidate of candidates) {
    if (!candidate.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(candidate) as { data?: { path?: unknown } };
      if (typeof parsed.data?.path === "string" && parsed.data.path.trim()) return parsed.data.path.trim();
    } catch {
      // A plain-text line beginning with "{" is handled by the fallback below.
    }
  }

  const match = output.match(/(?:screenshot\s+)?saved to|screenshot:/i);
  if (match?.index === undefined) return undefined;
  const path = output.slice(match.index + match[0].length).split(/\r?\n/, 1)[0]?.trim();
  return path?.replace(/^(["'])(.*)\1$/, "$2") || undefined;
}

export function countSnapshotRefs(output: string): number {
  const refs = new Set<string>();
  for (const match of output.matchAll(/(?:@|ref=)(e\d+)/g)) refs.add(match[1]!);
  return refs.size;
}

export function combineSuccessfulOutput(stdout: string, stderr: string): string {
  const primary = stdout.trim();
  const warning = stderr.trim();
  if (!warning) return primary;
  return `${primary ? `${primary}\n\n` : ""}[stderr warning]\n${warning}`;
}

function capDiagnostic(text: string, limit = MAX_ERROR_DIAGNOSTIC_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[diagnostics truncated]`;
}

export function assertCliSuccess(result: CliResult, action: string): void {
  if (result.code === 0) return;
  const perStreamLimit = Math.floor(MAX_ERROR_DIAGNOSTIC_CHARS / 2) - 128;
  const diagnostics = [
    result.stdout.trim() ? `[stdout]\n${capDiagnostic(result.stdout.trim(), perStreamLimit)}` : "",
    result.stderr.trim() ? `[stderr]\n${capDiagnostic(result.stderr.trim(), perStreamLimit)}` : "",
  ].filter(Boolean).join("\n\n");
  const message = `agent-browser ${action} failed (exit ${result.code ?? "unknown"})`;
  throw new Error(capDiagnostic(diagnostics ? `${message}\n\n${diagnostics}` : message));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Browser command cancelled.");
}

export class SessionQueue {
  private readonly tails = new Map<string, Promise<void>>();

  hasPending(sessionName: string): boolean {
    return this.tails.has(sessionName);
  }

  async run<T>(sessionName: string, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionName) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      throwIfAborted(signal);
      return operation();
    });
    const tail = current.then(() => undefined, () => undefined);
    this.tails.set(sessionName, tail);

    try {
      return await current;
    } finally {
      if (this.tails.get(sessionName) === tail) this.tails.delete(sessionName);
    }
  }
}
