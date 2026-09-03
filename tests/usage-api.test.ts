import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFirecrawlUsage, normalizeTavilyUsage } from "../extensions/shared/usage-api.ts";

test("normalizes Firecrawl remaining and plan credits", () => {
	assert.deepEqual(normalizeFirecrawlUsage({
		success: true,
		data: {
			remainingCredits: 929,
			planCredits: 1000,
			billingPeriodEnd: "2026-08-16T12:59:57.605Z",
		},
	}), {
		provider: "firecrawl",
		used: 71,
		limit: 1000,
		remaining: 929,
		resetAt: "2026-08-16T12:59:57.605Z",
		status: "ok",
	});
});

test("normalizes Tavily account plan usage", () => {
	assert.deepEqual(normalizeTavilyUsage({
		key: { usage: 29, limit: null },
		account: { current_plan: "Researcher", plan_usage: 29, plan_limit: 1000 },
	}), {
		provider: "tavily",
		used: 29,
		limit: 1000,
		remaining: 971,
		plan: "Researcher",
		status: "ok",
	});
});

test("falls back to Tavily key usage when account totals are absent", () => {
	assert.deepEqual(normalizeTavilyUsage({ key: { usage: "12", limit: "100" } }), {
		provider: "tavily",
		used: 12,
		limit: 100,
		remaining: 88,
		plan: undefined,
		status: "ok",
	});
});

test("rejects malformed usage responses", () => {
	assert.throws(() => normalizeFirecrawlUsage({ success: false, error: "denied" }), /denied/);
	assert.throws(() => normalizeTavilyUsage({ account: {} }), /missing usage total/);
});
