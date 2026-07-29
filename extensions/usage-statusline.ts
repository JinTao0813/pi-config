import os from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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
type WhamWindowRaw = {
	used_percent?: unknown;
	reset_after_seconds?: unknown;
	limit_window_seconds?: unknown;
	reset_at?: unknown;
};
type NormalizedRateWindow = {
	usedPercent: number;
	resetAfterSeconds?: number;
	limitWindowSeconds?: number;
	resetAt?: number;
};

const CACHE_TTL_MS = Number(process.env.PI_CODEX_USAGE_STATUS_TTL_SECONDS ?? process.env.PI_CODEX_USAGE_CACHE_TTL_SECONDS ?? 300) * 1000;
const POLL_MS = Number(process.env.PI_CODEX_USAGE_STATUS_POLL_SECONDS ?? 300) * 1000;
const DEFAULT_WHAM_URL = "https://chatgpt.com/backend-api/wham/usage";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

let cache: { at: number; snapshot: CodexUsageSnapshot } | undefined;
let currentSnapshot: CodexUsageSnapshot | undefined;
let lastCtx: ExtensionContext | undefined;
let pollTimer: NodeJS.Timeout | undefined;
let refreshInFlight: Promise<void> | undefined;
let requestFooterRender: (() => void) | undefined;
let currentThinkingLevel: string | undefined;

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

function formatCwdForFooter(cwd: string, home?: string): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome = relativeToHome === "" || (relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
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

function renderBuiltinishFooter(ctx: ExtensionContext, theme: any, footerData: any, width: number): string[] {
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;
	let latestCacheHitRate: number | undefined;

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const usage = entry.message.usage;
			totalInput += usage.input ?? 0;
			totalOutput += usage.output ?? 0;
			totalCacheRead += usage.cacheRead ?? 0;
			totalCacheWrite += usage.cacheWrite ?? 0;
			totalCost += usage.cost?.total ?? 0;
			const latestPromptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
			latestCacheHitRate = latestPromptTokens > 0 ? ((usage.cacheRead ?? 0) / latestPromptTokens) * 100 : undefined;
		}
	}

	let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
	const branch = footerData.getGitBranch?.();
	if (branch) pwd = `${pwd} (${branch})`;
	const sessionName = ctx.sessionManager.getSessionName?.();
	if (sessionName) pwd = `${pwd} • ${sessionName}`;

	const statsParts: string[] = [];
	if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
	if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
	if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
	if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
	if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
	if (totalCost || ctx.model) statsParts.push(`$${totalCost.toFixed(3)}${ctx.model ? " (sub)" : ""}`);

	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextPercent = contextUsage?.percent == null ? "?" : `${contextUsage.percent.toFixed(1)}%`;
	statsParts.push(`${contextPercent}/${formatTokens(contextWindow)} (auto)`);

	let statsLeft = statsParts.join(" ");
	if (visibleWidth(statsLeft) > width) statsLeft = truncateToWidth(statsLeft, width, "...");

	const modelName = ctx.model?.id || "no-model";
	let rightSide = modelName;
	if (ctx.model?.reasoning) rightSide = `${modelName} • ${currentThinkingLevel ?? "?"}`;

	const statsLeftWidth = visibleWidth(statsLeft);
	const rightSideWidth = visibleWidth(rightSide);
	const padding = " ".repeat(Math.max(2, width - statsLeftWidth - rightSideWidth));
	const statsLine = truncateToWidth(statsLeft + padding + rightSide, width, theme.fg("dim", "..."));

	return [
		truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
		theme.fg("dim", statsLine),
	];
}

export function renderUsageLines(ctx: ExtensionContext, snapshot: CodexUsageSnapshot | undefined): string[] {
	const model = ctx.model?.id ?? "model";
	const names: UsageWindowName[] = ["session", "week"];
	if (!snapshot) return names.map((name) => `${model} ${name === "session" ? "5 hour session" : "weekly"}: refreshing usage…`);
	const stale = snapshot.warnings.some((w) => w.startsWith("stale:")) ? " stale" : "";
	return names.map((name) => {
		const label = name === "session" ? "5 hour session" : "weekly";
		const window = snapshot.windows.find((candidate) => candidate.name === name);
		if (!window) {
			const unavailable = snapshot.dataSource === "chatgpt-wham" ? "not reported by API" : "usage unavailable";
			return `${model} ${label}: ${unavailable}`;
		}
		if (window.usedPercent == null) return `${model} ${label}: usage unavailable`;
		const used = Math.round(window.usedPercent);
		const left = Math.max(0, Math.round(100 - window.usedPercent));
		const reset = window.resetAt ? ` · resets ${new Date(window.resetAt).toLocaleString()}` : "";
		return `${model} ${label} [${bar(used)}] ${used}% used · ${left}% left${reset} · ${snapshot.dataSource}${stale}`;
	});
}

function installCustomFooter(ctx: ExtensionContext) {
	ctx.ui.setStatus("usage-context", undefined);
	ctx.ui.setStatus("usage-session", undefined);
	ctx.ui.setStatus("usage-weekly", undefined);
	ctx.ui.setFooter((tui, theme, footerData) => {
		requestFooterRender = () => tui.requestRender();
		const unsub = footerData.onBranchChange?.(() => tui.requestRender());
		return {
			dispose() {
				unsub?.();
				if (requestFooterRender) requestFooterRender = undefined;
			},
			invalidate() { tui.requestRender(); },
			render(width: number): string[] {
				const activeCtx = lastCtx ?? ctx;
				const lines = renderBuiltinishFooter(activeCtx, theme, footerData, width);
				lines.push(theme.fg("dim", truncateToWidth(renderContext(activeCtx), width, theme.fg("dim", "..."))));
				for (const usageLine of renderUsageLines(activeCtx, currentSnapshot)) {
					lines.push(theme.fg("dim", truncateToWidth(usageLine, width, theme.fg("dim", "..."))));
				}
				return lines;
			},
		};
	});
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

export function normalizeWhamSnapshot(raw: WhamRaw): CodexUsageSnapshot {
	const now = new Date();
	const windows: UsageWindow[] = [];
	const primary = normalizeRateWindow(raw.rate_limit?.primary_window);
	const secondary = normalizeRateWindow(raw.rate_limit?.secondary_window);
	if (primary) windows.push(rateToWindow(classifyWindow(primary, "session"), primary, now));
	if (secondary) windows.push(rateToWindow(classifyWindow(secondary, "week"), secondary, now));
	return {
		planName: raw.plan_type,
		dataSource: "chatgpt-wham",
		lastUpdated: now.toISOString(),
		warnings: [],
		windows,
		credits: raw.credits ? { hasCredits: raw.credits.has_credits, unlimited: raw.credits.unlimited, balance: raw.credits.balance } : undefined,
	};
}

function classifyWindow(window: NormalizedRateWindow, fallback: UsageWindowName): UsageWindowName {
	if (window.limitWindowSeconds === undefined) return fallback;
	return window.limitWindowSeconds >= 3 * 24 * 60 * 60 ? "week" : "session";
}

function rateToWindow(name: UsageWindowName, window: NormalizedRateWindow, now: Date): UsageWindow {
	const resetAt = window.resetAt !== undefined
		? new Date(window.resetAt * 1000).toISOString()
		: window.resetAfterSeconds === undefined
			? undefined
			: new Date(now.getTime() + window.resetAfterSeconds * 1000).toISOString();
	return { name, usedPercent: window.usedPercent, resetAt, status: "ok" };
}

function normalizeRateWindow(raw: WhamWindowRaw | undefined): NormalizedRateWindow | undefined {
	const usedPercent = toFiniteNumber(raw?.used_percent);
	if (usedPercent === undefined) return undefined;
	return {
		usedPercent,
		resetAfterSeconds: toFiniteNumber(raw?.reset_after_seconds),
		limitWindowSeconds: toFiniteNumber(raw?.limit_window_seconds),
		resetAt: toFiniteNumber(raw?.reset_at),
	};
}

function toFiniteNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

async function updateStatus(ctx: ExtensionContext, refresh = false) {
	lastCtx = ctx;
	currentSnapshot = await getSnapshot(ctx, refresh);
	requestFooterRender?.();
}

function scheduleRefresh(ctx: ExtensionContext, refresh = false) {
	lastCtx = ctx;
	requestFooterRender?.();
	if (refreshInFlight) return;
	refreshInFlight = updateStatus(ctx, refresh).finally(() => { refreshInFlight = undefined; });
}

export default function usageStatusline(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		lastCtx = ctx;
		currentThinkingLevel = getThinkingLevel(ctx);
		currentSnapshot = cache?.snapshot;
		installCustomFooter(ctx);
		scheduleRefresh(ctx, true);
		if (!pollTimer && POLL_MS > 0) pollTimer = setInterval(() => { if (lastCtx) scheduleRefresh(lastCtx, true); }, POLL_MS);
	});
	pi.on("message_end", (event, ctx) => {
		if (event.message.role === "assistant") scheduleRefresh(ctx, false);
	});
	pi.on("turn_end", (_event, ctx) => scheduleRefresh(ctx, false));
	pi.on("model_select", (_event, ctx) => scheduleRefresh(ctx, true));
	pi.on("thinking_level_select", (event, ctx) => {
		lastCtx = ctx;
		currentThinkingLevel = event.level;
		requestFooterRender?.();
	});
	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setFooter(undefined);
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = undefined;
		lastCtx = undefined;
		currentThinkingLevel = undefined;
		requestFooterRender = undefined;
	});

	pi.registerCommand("usage-refresh", {
		description: "Force refresh Codex usage footer status",
		handler: async (_args, ctx) => {
			await updateStatus(ctx as unknown as ExtensionContext, true);
			ctx.ui.notify("Usage status refreshed", "info");
		},
	});
}

export function getThinkingLevel(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "thinking_level_change") return entry.thinkingLevel;
	}
	return undefined;
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
