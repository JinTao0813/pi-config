import os from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export type UsageWindowName = "session" | "week" | "today";
export type UsageDataSource = "chatgpt-wham" | "configured-api" | "local-telemetry" | "unavailable";
export type UsageStatus = "ok" | "estimated" | "unavailable" | "partial" | "stale";

type RateWindow = { usedPercent: number; resetAfterSeconds?: number };
type WhamRaw = {
	plan_type?: string;
	rate_limit?: { primary_window?: WhamWindowRaw; secondary_window?: WhamWindowRaw };
	additional_rate_limits?: WhamAdditionalRaw[];
	credits?: { has_credits?: boolean; unlimited?: boolean; balance?: string };
};
type WhamWindowRaw = { used_percent?: unknown; reset_after_seconds?: unknown };
type WhamAdditionalRaw = { metered_feature?: string; limit_name?: string; rate_limit?: { primary_window?: WhamWindowRaw } };

export interface UsageWindow {
	name: UsageWindowName;
	start: string;
	end: string;
	used: number;
	unit: string;
	limit?: number;
	remaining?: number;
	resetAt?: string;
	status: UsageStatus;
	warnings: string[];
	usedPercent?: number;
}

export interface CodexUsageSnapshot {
	planName?: string;
	dataSource: UsageDataSource;
	lastUpdated: string;
	windows: UsageWindow[];
	warnings: string[];
	additional?: { name: string; usedPercent: number; resetAfterSeconds?: number }[];
	credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string };
}

export interface CodexUsageProvider {
	readonly source: UsageDataSource;
	getUsage(ctx: ExtensionCommandContext, options: UsageOptions): Promise<CodexUsageSnapshot>;
}

interface UsageOptions {
	refresh: boolean;
	weekStartsOn: "monday" | "sunday";
}

const CACHE_TTL_MS = Number(process.env.PI_CODEX_USAGE_CACHE_TTL_SECONDS ?? 300) * 1000;
const DEFAULT_WHAM_URL = "https://chatgpt.com/backend-api/wham/usage";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
let cache: { at: number; snapshot: CodexUsageSnapshot } | undefined;

const nowIso = () => new Date().toISOString();
const env = (name: string) => process.env[name]?.trim() || undefined;

function startOfToday(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function startOfWeek(d = new Date(), startsOn: "monday" | "sunday" = "monday") {
	const day = d.getDay();
	const diff = startsOn === "monday" ? (day === 0 ? 6 : day - 1) : day;
	const start = startOfToday(d); start.setDate(start.getDate() - diff); return start;
}
function windowEnd(start: Date, days: number) { const end = new Date(start); end.setDate(end.getDate() + days); return end; }

function parseArgs(args: string) {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	return { json: parts.includes("--json"), refresh: parts.includes("--refresh") || parts.includes("refresh"), help: parts.includes("--help") || parts.includes("-h") || parts.includes("help"), unknown: parts.filter((p) => !["--json", "--refresh", "refresh", "--help", "-h", "help"].includes(p)) };
}

class ChatGptWhamUsageProvider implements CodexUsageProvider {
	readonly source = "chatgpt-wham" as const;
	async getUsage(ctx: ExtensionCommandContext): Promise<CodexUsageSnapshot> {
		const provider = env("CODEX_USAGE_PROVIDER") || env("PI_CODEX_USAGE_PROVIDER") || "openai-codex";
		const url = env("CODEX_USAGE_URL") || env("PI_CODEX_USAGE_URL") || DEFAULT_WHAM_URL;
		const timeoutMs = Number(env("CODEX_USAGE_TIMEOUT_MS") || env("PI_CODEX_USAGE_TIMEOUT_MS") || 15000);
		const token = await (ctx as any).modelRegistry?.getApiKeyForProvider?.(provider);
		if (!token) throw new Error(`No auth for provider "${provider}". Run /login and choose ChatGPT Plus/Pro (Codex).`);
		const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
		applyChatGPTHeaders(url, token, headers);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, { method: "GET", headers, signal: controller.signal, cache: "no-store" });
			const text = await response.text();
			if (!response.ok) throw new Error(`ChatGPT usage request failed (${response.status} ${response.statusText}): ${truncate(text, 280)}`);
			const raw = text ? JSON.parse(text) : {};
			if (!looksLikeWhamUsage(raw)) throw new Error("Usage response JSON did not include recognizable ChatGPT WHAM usage fields.");
			return normalizeWhamSnapshot(raw);
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") throw new Error(`ChatGPT usage request timed out after ${Math.round(timeoutMs / 1000)}s`);
			throw error;
		} finally { clearTimeout(timeout); }
	}
}

function normalizeApiSnapshot(raw: any): CodexUsageSnapshot {
	const warnings: string[] = Array.isArray(raw?.warnings) ? raw.warnings.map(String) : [];
	return { planName: typeof raw?.planName === "string" ? raw.planName : undefined, dataSource: "configured-api", lastUpdated: typeof raw?.lastUpdated === "string" ? raw.lastUpdated : nowIso(), warnings,
		windows: ["today", "week"].map((name) => { const w = raw?.windows?.[name] ?? raw?.[name] ?? {}; const used = Number(w.used ?? 0); const limit = w.limit === undefined || w.limit === null ? undefined : Number(w.limit); return { name: name as UsageWindowName, start: String(w.start ?? ""), end: String(w.end ?? ""), used, unit: String(w.unit ?? raw?.unit ?? "requests"), limit: Number.isFinite(limit) ? limit : undefined, remaining: w.remaining === undefined || w.remaining === null ? (Number.isFinite(limit) ? Math.max(0, (limit as number) - used) : undefined) : Number(w.remaining), resetAt: typeof w.resetAt === "string" ? w.resetAt : undefined, status: (w.status as UsageStatus) ?? (limit === undefined ? "partial" : "ok"), warnings: Array.isArray(w.warnings) ? w.warnings.map(String) : [], usedPercent: Number.isFinite(Number(w.usedPercent)) ? Number(w.usedPercent) : undefined }; }) };
}

class ConfiguredApiUsageProvider implements CodexUsageProvider {
	readonly source = "configured-api" as const;
	async getUsage(): Promise<CodexUsageSnapshot> {
		const endpoint = env("PI_CODEX_USAGE_ENDPOINT"); const token = env("PI_CODEX_USAGE_API_KEY");
		if (!endpoint || !token) throw new Error("Configured API usage provider is missing PI_CODEX_USAGE_ENDPOINT or PI_CODEX_USAGE_API_KEY");
		const res = await fetch(endpoint, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, cache: "no-store" });
		if (!res.ok) throw new Error(`Configured API usage provider returned HTTP ${res.status}`);
		return normalizeApiSnapshot(await res.json());
	}
}

class LocalTelemetryUsageProvider implements CodexUsageProvider {
	readonly source = "local-telemetry" as const;
	async getUsage(ctx: ExtensionCommandContext, options: UsageOptions): Promise<CodexUsageSnapshot> {
		const now = new Date(); const todayStart = startOfToday(now); const weekStart = startOfWeek(now, options.weekStartsOn); const todayEnd = windowEnd(todayStart, 1); const weekEnd = windowEnd(weekStart, 7);
		const entries = ctx.sessionManager.getEntries() as any[];
		const countSince = (start: Date) => entries.filter((e) => { const m = e?.message; if (e?.type !== "message" || m?.role !== "assistant") return false; const providerModel = `${m.provider ?? ""}/${m.model ?? ""}`.toLowerCase(); if (!providerModel.includes("codex") && !providerModel.includes("openai")) return false; const ts = new Date(e.timestamp ?? m.timestamp ?? 0).getTime(); return Number.isFinite(ts) && ts >= start.getTime() && ts <= now.getTime(); }).length;
		const make = (name: UsageWindowName, start: Date, end: Date): UsageWindow => ({ name, start: start.toISOString(), end: end.toISOString(), used: countSince(start), unit: "estimated requests", resetAt: end.toISOString(), status: "estimated", warnings: ["Estimated from local Pi session telemetry only; limits are not available."] });
		return { dataSource: "local-telemetry", lastUpdated: nowIso(), warnings: ["Authoritative Codex subscription usage unavailable; showing local estimate."], windows: [make("today", todayStart, todayEnd), make("week", weekStart, weekEnd)] };
	}
}

class UnavailableUsageProvider implements CodexUsageProvider { readonly source = "unavailable" as const; async getUsage(): Promise<CodexUsageSnapshot> { return { dataSource: "unavailable", lastUpdated: nowIso(), warnings: ["No usage provider could return data."], windows: [] }; } }

async function getSnapshot(ctx: ExtensionCommandContext, options: UsageOptions): Promise<CodexUsageSnapshot> {
	if (!options.refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot;
	const warnings: string[] = [];
	const providers: CodexUsageProvider[] = [new ChatGptWhamUsageProvider(), new ConfiguredApiUsageProvider(), new LocalTelemetryUsageProvider(), new UnavailableUsageProvider()];
	for (const provider of providers) { try { const snapshot = await provider.getUsage(ctx, options); snapshot.warnings = [...warnings, ...(snapshot.warnings ?? [])]; cache = { at: Date.now(), snapshot }; return snapshot; } catch (err) { warnings.push(err instanceof Error ? err.message : String(err)); } }
	return new UnavailableUsageProvider().getUsage(ctx, options);
}

function normalizeWhamSnapshot(raw: WhamRaw): CodexUsageSnapshot {
	const now = new Date();
	const windows: UsageWindow[] = [];
	const primary = normalizeRateWindow(raw.rate_limit?.primary_window);
	const secondary = normalizeRateWindow(raw.rate_limit?.secondary_window);
	if (primary) windows.push(rateToWindow("session", primary, now));
	if (secondary) windows.push(rateToWindow("week", secondary, now));
	return { planName: raw.plan_type, dataSource: "chatgpt-wham", lastUpdated: now.toISOString(), warnings: [], windows,
		additional: raw.additional_rate_limits?.map((x) => ({ name: x.limit_name || x.metered_feature || "other", ...normalizeRateWindow(x.rate_limit?.primary_window)! })).filter((x) => Number.isFinite(x.usedPercent)),
		credits: raw.credits ? { hasCredits: raw.credits.has_credits, unlimited: raw.credits.unlimited, balance: raw.credits.balance } : undefined };
}
function rateToWindow(name: UsageWindowName, w: RateWindow, now: Date): UsageWindow { const resetAt = w.resetAfterSeconds === undefined ? undefined : new Date(now.getTime() + w.resetAfterSeconds * 1000).toISOString(); return { name, start: "", end: resetAt ?? "", used: Math.round(w.usedPercent), unit: "% used", limit: 100, remaining: Math.max(0, Math.round(100 - w.usedPercent)), resetAt, status: "ok", warnings: [], usedPercent: w.usedPercent }; }
function normalizeRateWindow(raw: WhamWindowRaw | undefined): RateWindow | undefined { const usedPercent = toFiniteNumber(raw?.used_percent); return usedPercent === undefined ? undefined : { usedPercent, resetAfterSeconds: toFiniteNumber(raw?.reset_after_seconds) }; }
function looksLikeWhamUsage(raw: unknown): raw is WhamRaw { const obj = raw as WhamRaw; return Boolean(raw && typeof raw === "object" && (obj.plan_type || toFiniteNumber(obj.rate_limit?.primary_window?.used_percent) !== undefined || toFiniteNumber(obj.rate_limit?.secondary_window?.used_percent) !== undefined)); }
function toFiniteNumber(value: unknown): number | undefined { if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && value.trim()) { const parsed = Number(value.trim()); if (Number.isFinite(parsed)) return parsed; } return undefined; }

function bar(usedPercent: number, width = 20) { const used = Math.max(0, Math.min(width, Math.round((usedPercent / 100) * width))); return `[${"█".repeat(used)}${"░".repeat(width - used)}]`; }
function amount(w: UsageWindow) { if (w.usedPercent !== undefined) { const left = Math.max(0, 100 - w.usedPercent); const reset = w.resetAt ? `, resets ${new Date(w.resetAt).toLocaleString()}` : ""; return `${bar(w.usedPercent)} ${Math.round(w.usedPercent)}% used, ${Math.round(left)}% left${reset}`; } const base = `${w.used} ${w.unit}`; const limit = w.limit !== undefined ? ` / ${w.limit}` : " / limit unavailable"; const rem = w.remaining !== undefined ? `, ${w.remaining} remaining` : ""; const reset = w.resetAt ? `, resets ${new Date(w.resetAt).toLocaleString()}` : ""; return `${base}${limit}${rem}${reset}`; }
function renderText(s: CodexUsageSnapshot) { const lines = [`Codex usage${s.planName ? ` (${capitalize(s.planName)})` : ""}:`]; for (const w of s.windows) lines.push(`- ${w.name}: ${amount(w)} [${w.status}]`); if (s.additional?.length) { lines.push("Additional limits:"); for (const a of s.additional.slice(0, 6)) lines.push(`- ${a.name}: ${bar(a.usedPercent)} ${Math.round(a.usedPercent)}% used${a.resetAfterSeconds ? `, resets in ${formatRelativeSeconds(a.resetAfterSeconds)}` : ""}`); } if (s.credits) lines.push(`Credits: ${s.credits.unlimited ? "unlimited" : s.credits.balance ? `balance ${s.credits.balance}` : s.credits.hasCredits ? "available" : "none"}`); lines.push(`Data source: ${s.dataSource}`); lines.push(`Last updated: ${new Date(s.lastUpdated).toLocaleString()}`); const warnings = [...s.warnings, ...s.windows.flatMap((w) => w.warnings)].filter(Boolean); if (warnings.length) lines.push(`Warnings: ${[...new Set(warnings)].join("; ")}`); return lines.join("\n"); }

const help = `Usage command\n\n/usage              Show Codex usage with bars\n/usage refresh      Force a fresh fetch\n/usage --json       Output structured JSON\n/usage --help       Show this help\n\nDefault real usage provider: ChatGPT WHAM (${DEFAULT_WHAM_URL}) using your Pi /login auth for openai-codex.\nOptional overrides: CODEX_USAGE_PROVIDER, CODEX_USAGE_URL, CODEX_USAGE_TIMEOUT_MS, PI_CODEX_USAGE_ENDPOINT, PI_CODEX_USAGE_API_KEY, PI_CODEX_USAGE_WEEK_START=sunday|monday.`;

export default function (pi: ExtensionAPI) { pi.registerCommand("usage", { description: "Show Codex subscription usage", handler: async (args, ctx) => { try { const parsed = parseArgs(args); if (parsed.help || parsed.unknown.length) { pi.sendMessage({ customType: "codex-usage", content: parsed.unknown.length ? `${help}\n\nUnknown arguments: ${parsed.unknown.join(", ")}` : help, display: true }); return; } const weekStartsOn = env("PI_CODEX_USAGE_WEEK_START") === "sunday" ? "sunday" : "monday"; const snapshot = await getSnapshot(ctx, { refresh: parsed.refresh, weekStartsOn }); pi.sendMessage({ customType: "codex-usage", content: parsed.json ? JSON.stringify(snapshot, null, 2) : renderText(snapshot), display: true, details: snapshot }); } catch (err) { const snapshot = await new UnavailableUsageProvider().getUsage(); snapshot.warnings.unshift(err instanceof Error ? err.message : String(err)); pi.sendMessage({ customType: "codex-usage", content: args.split(/\s+/).includes("--json") ? JSON.stringify(snapshot, null, 2) : renderText(snapshot), display: true, details: snapshot }); } } }); }

function applyChatGPTHeaders(url: string, token: string, headers: Record<string, string>) { if (!isChatGPTBackendUrl(url)) return; const accountId = extractAccountId(token); if (accountId) headers["chatgpt-account-id"] = accountId; headers.originator = "pi"; headers["User-Agent"] = `pi (${os.platform()} ${os.release()}; ${os.arch()})`; }
function extractAccountId(token: string): string | undefined { try { const segment = token.split(".")[1]; if (!segment) return undefined; const payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>; const auth = payload[JWT_CLAIM_PATH] as Record<string, unknown> | undefined; const accountId = auth?.chatgpt_account_id; return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined; } catch { return undefined; } }
function isChatGPTBackendUrl(url: string): boolean { try { const parsed = new URL(url); return parsed.hostname === "chatgpt.com" && parsed.pathname.startsWith("/backend-api/"); } catch { return false; } }
function formatRelativeSeconds(seconds: number): string { if (seconds <= 0) return "now"; const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); const minutes = Math.floor((seconds % 3600) / 60); const parts: string[] = []; if (days) parts.push(`${days}d`); if (hours) parts.push(`${hours}h`); if (minutes && parts.length < 2) parts.push(`${minutes}m`); if (parts.length === 0) parts.push(`${seconds}s`); return parts.slice(0, 2).join(" "); }
function capitalize(value: string): string { return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value; }
function truncate(value: string, maxLength: number): string { const compact = value.replace(/\s+/g, " ").trim(); return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact; }
