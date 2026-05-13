import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type, type Static } from "typebox";

const TOOL_DESCRIPTION = `Browser automation via agent-browser CLI.
Typical workflow: open URL → snapshot -i → use @refs from snapshot → interact → re-snapshot after changes.
Useful commands:
  open <url>                         Navigate
  snapshot -i                        Accessibility/interactive snapshot with @e refs
  click <@ref>                       Click element
  fill <@ref> <text>                 Clear + type
  type <@ref> <text>                 Type without clearing
  select <@ref> <value>              Select dropdown option
  press <key>                        Press key: Enter, Tab, Escape, etc.
  scroll <dir> [px]                  Scroll: up/down/left/right
  get text|url|title [@ref]          Read info
  wait <@ref|ms>                     Wait for element or milliseconds
  screenshot [--full]                Return screenshot inline
  close                              Close browser
Quoting supported, e.g. fill @e3 "hello world". Any agent-browser command is accepted.`;

const schema = Type.Object({
  command: Type.String({ description: "agent-browser command, without the agent-browser prefix" }),
  timeoutMs: Type.Optional(Type.Number({ minimum: 1000, maximum: 300000, description: "Command timeout. Default 60000." })),
});
export type BrowserUseInput = Static<typeof schema>;

function writeTempFile(content: string, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pi-browser-${prefix || "output"}-`));
  const file = join(dir, "output.txt");
  writeFileSync(file, content);
  return file;
}

function splitArgs(input: string): string[] {
  const out: string[] = [];
  let cur = "", quote: "'" | '"' | null = null, esc = false;
  for (const ch of input.trim()) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === "\\" && quote !== "'") { esc = true; continue; }
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch as any; continue; }
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ""; } continue; }
    cur += ch;
  }
  if (esc) cur += "\\";
  if (quote) throw new Error(`Unclosed quote: ${quote}`);
  if (cur) out.push(cur);
  return out;
}

async function ensureInstalled(pi: ExtensionAPI, ctx: any): Promise<boolean> {
  const check = await pi.exec("which", ["agent-browser"], { timeout: 5000 });
  if (check.code === 0 && check.stdout.trim()) return true;
  if (!ctx.hasUI) return false;
  const ok = await ctx.ui.confirm("agent-browser not found", "Install globally? npm install -g agent-browser && agent-browser install");
  if (!ok) return false;
  ctx.ui.notify("Installing agent-browser...", "info");
  const install = await pi.exec("npm", ["install", "-g", "agent-browser"], { timeout: 120000 });
  if (install.code !== 0) { ctx.ui.notify(`agent-browser install failed: ${install.stderr || install.stdout}`, "error"); return false; }
  ctx.ui.notify("Installing browser runtime...", "info");
  const browser = await pi.exec("agent-browser", ["install"], { timeout: 120000 });
  if (browser.code !== 0) { ctx.ui.notify(`browser runtime install failed: ${browser.stderr || browser.stdout}`, "error"); return false; }
  ctx.ui.notify("agent-browser ready", "success");
  return true;
}

function screenshotPath(output: string): string | undefined {
  return output.match(/(?:saved to|screenshot:)\s*(.+)$/im)?.[1]?.trim();
}

export default function browserUseExtension(pi: ExtensionAPI) {
  pi.registerCommand("browser-install", {
    description: "Install agent-browser and its browser runtime",
    handler: async (_args, ctx) => { await ensureInstalled(pi, ctx); },
  });

  pi.registerTool({
    name: "browser",
    label: "Browser",
    description: TOOL_DESCRIPTION,
    promptSnippet: "Automate a real browser: open pages, snapshot UI, click/type/scroll, and return screenshots.",
    promptGuidelines: [
      "Use browser when the user asks to inspect a live website, UI/UX layout, visual state, or click-through flow.",
      "After browser actions that can change page state, call browser snapshot -i again before relying on old @refs.",
      "Use browser screenshot --full when visual layout, spacing, typography, or responsive UI matters.",
    ],
    parameters: schema,

    renderCall(args: BrowserUseInput, theme: any) {
      return new Text(theme.fg("toolTitle", theme.bold("browser ")) + theme.fg("accent", args.command), 0, 0);
    },

    renderResult(result: any, { expanded, isPartial }: { expanded: boolean; isPartial: boolean }, theme: any) {
      if (isPartial) return new Text(theme.fg("warning", "Running..."), 0, 0);
      const details = result.details || {};
      if (result.isError || details.error) return new Text(theme.fg("error", details.error || result.content?.[0]?.text || "Error"), 0, 0);
      const text = result.content?.[0]?.text || "";
      if (details.action === "screenshot") return new Text(theme.fg("success", `Screenshot: ${details.screenshotPath || "returned"}`), 0, 0);
      if (details.action === "snapshot") {
        const count = (text.match(/@e\d+/g) || []).length;
        return new Text(theme.fg("success", `${count} interactive elements`) + (details.truncated ? theme.fg("warning", " (truncated)") : "") + (expanded ? "\n" + theme.fg("dim", text) : ""), 0, 0);
      }
      return new Text(theme.fg("dim", expanded ? text : ((text.split("\n")[0] || "(no output)") + (text.includes("\n") ? "…" : ""))), 0, 0);
    },

    async execute(_toolCallId, params: BrowserUseInput, signal, _onUpdate, ctx) {
      const installed = await ensureInstalled(pi, ctx);
      if (!installed) return { content: [{ type: "text", text: "agent-browser not installed. Run /browser-install or: npm install -g agent-browser && agent-browser install" }], details: { error: "not-installed" }, isError: true };

      let parts: string[];
      try { parts = splitArgs(params.command); } catch (err: any) { return { content: [{ type: "text", text: err.message }], details: { error: err.message }, isError: true }; }
      const action = (parts[0] || "").toLowerCase();
      if (!action) return { content: [{ type: "text", text: "Missing browser command" }], details: { error: "missing-command" }, isError: true };

      const res = await pi.exec("agent-browser", parts, { signal, timeout: params.timeoutMs ?? 60000 });
      const raw = (res.stdout || res.stderr || "").trim();
      if (res.code !== 0) return { content: [{ type: "text", text: raw || `agent-browser failed: ${res.code}` }], details: { error: raw, exitCode: res.code, action, command: params.command }, isError: true };

      if (action === "screenshot") {
        const path = screenshotPath(raw);
        if (path) {
          try {
            const data = readFileSync(path).toString("base64");
            const ext = extname(path).toLowerCase();
            const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
            return { content: [{ type: "text", text: `Screenshot saved: ${path}` }, { type: "image", data, mimeType }], details: { action, command: params.command, screenshotPath: path } };
          } catch (err: any) {
            return { content: [{ type: "text", text: `Screenshot saved: ${path}; read failed: ${err.message}` }], details: { action, command: params.command, screenshotPath: path, readError: err.message } };
          }
        }
      }

      const trunc = truncateHead(raw, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
      let text = trunc.content || "(no output)";
      if (trunc.truncated) {
        const file = writeTempFile(raw, action);
        text += `\n\n[Output truncated: ${trunc.outputLines}/${trunc.totalLines} lines, ${formatSize(trunc.outputBytes)}/${formatSize(trunc.totalBytes)}. Full output: ${file}]`;
      }
      return { content: [{ type: "text", text }], details: { action, command: params.command, truncated: trunc.truncated } };
    },
  });

  pi.on("session_shutdown", async () => {
    try { await pi.exec("agent-browser", ["close"], { timeout: 5000 }); } catch {}
  });
}
