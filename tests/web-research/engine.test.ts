import assert from "node:assert/strict";
import test from "node:test";

import { SearchCancelledError, SearchEngine } from "../../extensions/web-research/engine.ts";
import type { SearchProvider } from "../../extensions/web-research/types.ts";

function provider(name: SearchProvider["name"], rows: Awaited<ReturnType<SearchProvider["search"]>>): SearchProvider {
	return {
		name,
		isAvailable: () => true,
		search: async () => rows,
	};
}

test("falls back when every raw result is removed by domain filtering", async () => {
	const engine = new SearchEngine([
		provider("tavily", [
			{ title: "Wrong one", url: "https://irrelevant.test/a", snippet: "widgets" },
			{ title: "Wrong two", url: "https://irrelevant.test/b", snippet: "widgets" },
		]),
		provider("duckduckgo", [
			{ title: "Widget manual", url: "https://docs.example.com/widgets", snippet: "Official widget manual" },
		]),
	]);

	const result = await engine.search({
		query: "widget manual",
		limit: 2,
		domains: { include: ["example.com"] },
	});

	assert.equal(result.providerUsed, "duckduckgo");
	assert.deepEqual(result.sources.map((source) => source.url), ["https://docs.example.com/widgets"]);
	assert.deepEqual(result.attempts.map(({ provider, status, rawCount, acceptedCount }) => ({ provider, status, rawCount, acceptedCount })), [
		{ provider: "tavily", status: "insufficient", rawCount: 2, acceptedCount: 0 },
		{ provider: "duckduckgo", status: "success", rawCount: 1, acceptedCount: 1 },
	]);
});

test("retains the best insufficient attempt when later fallbacks are empty", async () => {
	const engine = new SearchEngine([
		provider("tavily", [{ title: "Only result", url: "https://example.com/only" }]),
		provider("duckduckgo", []),
	]);

	const result = await engine.search({ query: "only result", limit: 3 });

	assert.equal(result.providerUsed, "tavily");
	assert.equal(result.fallbackUsed, true);
	assert.deepEqual(result.sources.map((source) => source.url), ["https://example.com/only"]);
});

test("include and exclude domains match exact hosts and subdomains only", async () => {
	const engine = new SearchEngine([
		provider("tavily", [
			{ title: "Root", url: "https://example.com/root" },
			{ title: "Docs", url: "https://docs.example.com/guide" },
			{ title: "Blocked", url: "https://private.example.com/secret" },
			{ title: "Lookalike", url: "https://notexample.com/page" },
		]),
	]);

	const result = await engine.search({
		query: "guide",
		limit: 5,
		domains: { include: [".example.com"], exclude: ["private.example.com"] },
	});

	assert.deepEqual(result.sources.map((source) => source.url), [
		"https://docs.example.com/guide",
		"https://example.com/root",
	]);
});

test("canonical URLs remove tracking parameters and deduplicate equivalent rows", async () => {
	const engine = new SearchEngine([
		provider("firecrawl", [
			{ title: "Tracked", url: "https://www.example.com/article/?utm_source=newsletter&b=2&a=1#section" },
			{ title: "Duplicate", url: "https://example.com/article?a=1&b=2" },
			{ title: "Other", url: "https://example.com/other?utm_id=campaign" },
		]),
	]);

	const result = await engine.search({ query: "article", limit: 5 });

	assert.deepEqual(result.sources.map(({ id, url }) => ({ id, url })), [
		{ id: "[1]", url: "https://www.example.com/article?a=1&b=2" },
		{ id: "[2]", url: "https://example.com/other" },
	]);
});

test("malformed and empty provider rows are discarded", async () => {
	const rows = [
		null,
		{},
		{ title: "No URL", url: "" },
		{ title: "Unsafe", url: "javascript:alert(1)" },
		{ title: "", url: "https://example.com/valid", snippet: null },
	] as Awaited<ReturnType<SearchProvider["search"]>>;
	const engine = new SearchEngine([provider("duckduckgo", rows)]);

	const result = await engine.search({ query: "valid", limit: 3 });

	assert.deepEqual(result.sources, [{
		id: "[1]",
		title: "https://example.com/valid",
		url: "https://example.com/valid",
		excerpt: "",
		evidenceKind: "search-snippet",
		publishedAt: null,
		relevanceScore: 0.75,
	}]);
	assert.deepEqual(result.attempts.map(({ rawCount, acceptedCount }) => ({ rawCount, acceptedCount })), [
		{ rawCount: 5, acceptedCount: 1 },
	]);
});

test("equal-ranked sources keep stable order and obey the output limit", async () => {
	const engine = new SearchEngine([
		provider("tavily", [
			{ title: "Alpha Z", url: "https://example.com/z" },
			{ title: "Alpha A", url: "https://example.com/a" },
			{ title: "Alpha M", url: "https://example.com/m" },
		]),
	]);

	const first = await engine.search({ query: "alpha", limit: 2 });
	const second = await engine.search({ query: "alpha", limit: 2 });
	const identity = (result: typeof first) => result.sources.map(({ id, title }) => ({ id, title }));

	assert.deepEqual(identity(first), [
		{ id: "[1]", title: "Alpha Z" },
		{ id: "[2]", title: "Alpha A" },
	]);
	assert.deepEqual(identity(second), identity(first));
});

test("source text is bounded deterministically", async () => {
	const engine = new SearchEngine([
		provider("tavily", [{
			title: "T".repeat(500),
			url: "https://example.com/long",
			snippet: "S".repeat(5_000),
		}]),
	]);

	const result = await engine.search({ query: "long", limit: 1 });

	assert.equal(result.sources[0]?.title.length, 300);
	assert.equal(result.sources[0]?.excerpt.length, 1_200);
});

test("provider failures are categorized before fallback", async () => {
	const rateLimited: SearchProvider = {
		name: "tavily",
		isAvailable: () => true,
		search: async () => { throw Object.assign(new Error("request failed"), { status: 429 }); },
	};
	const engine = new SearchEngine([
		rateLimited,
		provider("duckduckgo", [{ title: "Result", url: "https://example.com/result" }]),
	]);

	const result = await engine.search({ query: "result", limit: 2 });

	assert.deepEqual(result.attempts.map(({ provider, status, errorCategory }) => ({ provider, status, errorCategory })), [
		{ provider: "tavily", status: "error", errorCategory: "rate_limit" },
		{ provider: "duckduckgo", status: "success", errorCategory: undefined },
	]);
});

test("cancellation stops fallback and preserves a sanitized attempt category", async () => {
	let fallbackCalled = false;
	const waiting: SearchProvider = {
		name: "tavily",
		isAvailable: () => true,
		search: async (_request, signal) => new Promise((_resolve, reject) => {
			signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
		}),
	};
	const fallback: SearchProvider = {
		name: "duckduckgo",
		isAvailable: () => true,
		search: async () => {
			fallbackCalled = true;
			return [{ title: "Should not run", url: "https://example.com" }];
		},
	};
	const controller = new AbortController();
	const pending = new SearchEngine([waiting, fallback]).search({ query: "cancel me" }, controller.signal);
	setImmediate(() => controller.abort(new Error("private cancellation reason")));

	await assert.rejects(pending, (error) => {
		assert.ok(error instanceof SearchCancelledError);
		assert.deepEqual(error.attempts.map(({ status, errorCategory }) => ({ status, errorCategory })), [
			{ status: "cancelled", errorCategory: "cancelled" },
		]);
		return true;
	});
	assert.equal(fallbackCalled, false);
});
