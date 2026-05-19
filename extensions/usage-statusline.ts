import os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type UsageWindowName = "session" | "week";
type UsageStatus = "ok" | "estimated" | "unavailable" | "partial" | "stale";
type UsageDataSource = "chatgpt-wham" | "configured-api" | "local-telemetry" | "unavailable";

type UsageWindow = {
	name: UsageWindowName;
	usedPercent?: number;
	resetAt?: string;
	status: UsageStatus;
};

type CodexUsageSnapshot = {
	planName?: string;
	dataSource: UsageDataSource;
	lastUpdated: string;
	windows: UsageWindow[];
	warnings: string[];
	credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string };
};

type WhamRaw = {
	plan_type?: string;
	rate_limit?: { primary_window?: WhamWindowRaw; secondary_window?: WhamWindowRaw };
	credits?: { has_credits?: boolean; unlimited?: boolean; balance?: string };
};
type WhamWindowRaw = { used_percent?: unknown; reset_after_seconds?: unknown };

const CACHE_TTL_MS = Number(process.env.PI_CODEX_USAGE_STATUS_TTL_SECONDS ?? process.env.PI_CODEX_USAGE_CACHE_TTL_SECONDS ?? 300) * 1000;
const POLL_MS = Number(process.env.PI_CODEX_USAGE_STATUS_POLL_SECONDS ?? 300) * 1000;
const DEFAULT_WHAM_URL = "https://chatgpt.com/backend-api/wham/usage";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

let cache: { at: number; snapshot: CodexUsageSnapshot } | undefined;
let lastCtx: ExtensionContext | undefined;
let pollTimer: NodeJS.Timeout | undefined;
let refreshInFlight: Promise<void> | undefined;

const env = (name: string) => process.env[name]?.trim() || undefined;

function formatTokens(count: number | null | undefined): string {
	if (count == null || !Number.isFinite(count)) return "?";
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function bar(percent: number, width = 10): string {
	const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
	return "█".repeat(filled) + "░".repeat(width - filled);
}

function renderContext(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	if (!usage) return "CTX unavailable";
	const used = usage.percent ?? 0;
	const left = Math.max(0, 100 - used);
	const window = usage.contextWindow ? `/${formatTokens(usage.contextWindow)}` : "";
	const pct = usage.percent == null ? "?" : `${used.toFixed(1)}%`;
	return `CTX [${bar(used)}] ${pct} used · ${left.toFixed(1)}% left · ${formatTokens(usage.tokens)}${window}`;
}

async function fetchWhamUsage(ctx: ExtensionContext): Promise<CodexUsageSnapshot> {
	const provider = env("CODEX_USAGE_PROVIDER") || env("PI_CODEX_USAGE_PROVIDER") || "openai-codex";
	const url = env("CODEX_USAGE_URL") || env("PI_CODEX_USAGE_URL") || DEFAULT_WHAM_URL;
	const timeoutMs = Number(env("CODEX_USAGE_TIMEOUT_MS") || env("PI_CODEX_USAGE_TIMEOUT_MS") || 15000);
	const token = await (ctx as any).modelRegistry?.getApiKeyForProvider?.(provider);
	if (!token) throw new Error(`No auth for provider ${provider}`);

	const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
	applyChatGPTHeaders(url, token, headers);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { method: "GET", headers, signal: controller.signal, cache: "no-store" });
		const text = await response.text();
		if (!response.ok) throw new Error(`WHAM usage HTTP ${response.status}: ${text.slice(0, 160)}`);
		const raw = text ? JSON.parse(text) as WhamRaw : {};
		return normalizeWhamSnapshot(raw);
	} finally {
		clearTimeout(timeout);
	}
}

async function getSnapshot(ctx: ExtensionContext, refresh = false): Promise<CodexUsageSnapshot> {
	if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot;
	try {
		const snapshot = await fetchWhamUsage(ctx);
		cache = { at: Date.now(), snapshot };
		return snapshot;
	} catch (error) {
		if (cache) return { ...cache.snapshot, warnings: [...cache.snapshot.warnings, `stale: ${error instanceof Error ? error.message : String(error)}`] };
		return { dataSource: "unavailable", lastUpdated: new Date().toISOString(), windows: [], warnings: [error instanceof Error ? error.message : String(error)] };
	}
}

function normalizeWhamSnapshot(raw: WhamRaw): CodexUsageSnapshot {
	const now = new Date();
	const windows: UsageWindow[] = [];
	const primary = normalizeRateWindow(raw.rate_limit?.primary_window);
	const secondary = normalizeRateWindow(raw.rate_limit?.secondary_window);
	if (primary) windows.push(rateToWindow("session", primary.usedPercent, primary.resetAfterSeconds, now));
	if (secondary) windows.push(rateToWindow("week", secondary.usedPercent, secondary.resetAfterSeconds, now));
	return {
		planName: raw.plan_type,
		dataSource: "chatgpt-wham",
		lastUpdated: now.toISOString(),
		warnings: [],
		windows,
		credits: raw.credits ? { hasCredits: raw.credits.has_credits, unlimited: raw.credits.unlimited, balance: raw.credits.balance } : undefined,
	};
}

function rateToWindow(name: UsageWindowName, usedPercent: number, resetAfterSeconds: number | undefined, now: Date): UsageWindow {
	return {
		name,
		usedPercent,
		resetAt: resetAfterSeconds === undefined ? undefined : new Date(now.getTime() + resetAfterSeconds * 1000).toISOString(),
		status: "ok",
	};
}

function normalizeRateWindow(raw: WhamWindowRaw | undefined): { usedPercent: number; resetAfterSeconds?: number } | undefined {
	const usedPercent = toFiniteNumber(raw?.used_percent);
	return usedPercent === undefined ? undefined : { usedPercent, resetAfterSeconds: toFiniteNumber(raw?.reset_after_seconds) };
}

function toFiniteNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function renderUsageLine(ctx: ExtensionContext, snapshot: CodexUsageSnapshot, name: UsageWindowName): string {
	const model = ctx.model?.id ?? "model";
	const window = snapshot.windows.find((w) => w.name === name);
	const label = name === "session" ? "5 hour session" : "weekly";
	if (!window?.usedPercent && window?.usedPercent !== 0) return `${model} ${label}: usage unavailable`;
	const used = Math.round(window.usedPercent);
	const left = Math.max(0, Math.round(100 - window.usedPercent));
	const reset = window.resetAt ? ` · resets ${new Date(window.resetAt).toLocaleString()}` : "";
	const stale = snapshot.warnings.some((w) => w.startsWith("stale:")) ? " stale" : "";
	return `${model} ${label} [${bar(used)}] ${used}% used · ${left}% left${reset} · ${snapshot.dataSource}${stale}`;
}

function setLoadingStatus(ctx: ExtensionContext) {
	ctx.ui.setStatus("usage-context", ctx.ui.theme.fg("dim", renderContext(ctx)));
	ctx.ui.setStatus("usage-session", ctx.ui.theme.fg("dim", `${ctx.model?.id ?? "model"} 5 hour session: refreshing usage…`));
	ctx.ui.setStatus("usage-weekly", ctx.ui.theme.fg("dim", `${ctx.model?.id ?? "model"} weekly: refreshing usage…`));
}

async function updateStatus(ctx: ExtensionContext, refresh = false) {
	lastCtx = ctx;
	ctx.ui.setStatus("usage-context", ctx.ui.theme.fg("dim", renderContext(ctx)));
	const snapshot = await getSnapshot(ctx, refresh);
	ctx.ui.setStatus("usage-session", ctx.ui.theme.fg("dim", renderUsageLine(ctx, snapshot, "session")));
	ctx.ui.setStatus("usage-weekly", ctx.ui.theme.fg("dim", renderUsageLine(ctx, snapshot, "week")));
}

function scheduleRefresh(ctx: ExtensionContext, refresh = false) {
	lastCtx = ctx;
	if (refreshInFlight) return;
	refreshInFlight = updateStatus(ctx, refresh).finally(() => { refreshInFlight = undefined; });
}

export default function usageStatusline(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		setLoadingStatus(ctx);
		scheduleRefresh(ctx, true);
		if (!pollTimer && POLL_MS > 0) pollTimer = setInterval(() => { if (lastCtx) scheduleRefresh(lastCtx, true); }, POLL_MS);
	});
	pi.on("message_end", (event, ctx) => {
		if (event.message.role === "assistant") scheduleRefresh(ctx, false);
	});
	pi.on("turn_end", (_event, ctx) => scheduleRefresh(ctx, false));
	pi.on("model_select", (_event, ctx) => scheduleRefresh(ctx, true));
	pi.on("session_shutdown", () => {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = undefined;
		lastCtx = undefined;
	});

	pi.registerCommand("usage-refresh", {
		description: "Force refresh Codex usage footer status",
		handler: async (_args, ctx) => {
			setLoadingStatus(ctx as unknown as ExtensionContext);
			await updateStatus(ctx as unknown as ExtensionContext, true);
			ctx.ui.notify("Usage status refreshed", "info");
		},
	});
}

function applyChatGPTHeaders(url: string, token: string, headers: Record<string, string>) {
	if (!isChatGPTBackendUrl(url)) return;
	const accountId = extractAccountId(token);
	if (accountId) headers["chatgpt-account-id"] = accountId;
	headers.originator = "pi";
	headers["User-Agent"] = `pi (${os.platform()} ${os.release()}; ${os.arch()})`;
}
function extractAccountId(token: string): string | undefined {
	try {
		const segment = token.split(".")[1];
		if (!segment) return undefined;
		const payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
		const auth = payload[JWT_CLAIM_PATH] as Record<string, unknown> | undefined;
		const accountId = auth?.chatgpt_account_id;
		return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
	} catch { return undefined; }
}
function isChatGPTBackendUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.hostname === "chatgpt.com" && parsed.pathname.startsWith("/backend-api/");
	} catch { return false; }
}
