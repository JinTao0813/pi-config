export type ExternalUsageProvider = "tavily" | "firecrawl";

export type ExternalUsageSnapshot = {
	provider: ExternalUsageProvider;
	used?: number;
	limit?: number;
	remaining?: number;
	plan?: string;
	resetAt?: string;
	status: "ok" | "unavailable" | "stale";
	warning?: string;
};

type FirecrawlUsageResponse = {
	success?: unknown;
	data?: {
		remainingCredits?: unknown;
		planCredits?: unknown;
		billingPeriodEnd?: unknown;
	};
	error?: unknown;
};

type TavilyUsageResponse = {
	key?: { usage?: unknown; limit?: unknown };
	account?: {
		current_plan?: unknown;
		plan_usage?: unknown;
		plan_limit?: unknown;
	};
};

function finiteNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function isoDate(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function normalizeFirecrawlUsage(raw: unknown): ExternalUsageSnapshot {
	const response = (raw && typeof raw === "object" ? raw : {}) as FirecrawlUsageResponse;
	if (response.success !== true) {
		const message = typeof response.error === "string" ? response.error : "invalid response";
		throw new Error(`Firecrawl usage: ${message}`);
	}
	const remaining = finiteNumber(response.data?.remainingCredits);
	const limit = finiteNumber(response.data?.planCredits);
	if (remaining === undefined || limit === undefined) throw new Error("Firecrawl usage: missing credit totals");
	return {
		provider: "firecrawl",
		used: Math.max(0, limit - remaining),
		limit,
		remaining: Math.max(0, remaining),
		resetAt: isoDate(response.data?.billingPeriodEnd),
		status: "ok",
	};
}

export function normalizeTavilyUsage(raw: unknown): ExternalUsageSnapshot {
	const response = (raw && typeof raw === "object" ? raw : {}) as TavilyUsageResponse;
	const accountUsed = finiteNumber(response.account?.plan_usage);
	const accountLimit = finiteNumber(response.account?.plan_limit);
	const keyUsed = finiteNumber(response.key?.usage);
	const keyLimit = finiteNumber(response.key?.limit);
	const used = accountUsed ?? keyUsed;
	const limit = accountLimit ?? keyLimit;
	if (used === undefined) throw new Error("Tavily usage: missing usage total");
	const plan = typeof response.account?.current_plan === "string" && response.account.current_plan.trim()
		? response.account.current_plan.trim()
		: undefined;
	return {
		provider: "tavily",
		used,
		limit,
		remaining: limit === undefined ? undefined : Math.max(0, limit - used),
		plan,
		status: "ok",
	};
}
