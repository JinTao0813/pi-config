import assert from "node:assert/strict";
import test from "node:test";

import { DuckDuckGoSearchProvider } from "../../extensions/web-research/providers/duckduckgo.ts";
import { FirecrawlSearchProvider } from "../../extensions/web-research/providers/firecrawl.ts";
import { TavilySearchProvider } from "../../extensions/web-research/providers/tavily.ts";
import type { FetchLike } from "../../extensions/web-research/providers/provider.ts";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("Tavily adapter translates the shared request and response", async () => {
	let captured: { input: string | URL; init?: RequestInit } | undefined;
	const fetchFn: FetchLike = async (input, init) => {
		captured = { input, init };
		return jsonResponse({ results: [{ title: "Guide", url: "https://docs.example.com/guide", content: "A guide", score: 0.8 }] });
	};
	const provider = new TavilySearchProvider("test-key", fetchFn);

	const hits = await provider.search({
		query: "example guide",
		limit: 3,
		recency: "month",
		domains: { include: ["example.com"], exclude: ["old.example.com"] },
	});

	assert.equal(String(captured?.input), "https://api.tavily.com/search");
	assert.deepEqual(JSON.parse(String(captured?.init?.body)), {
		query: "example guide",
		max_results: 3,
		search_depth: "basic",
		include_answer: false,
		include_raw_content: false,
		topic: "general",
		time_range: "month",
		include_domains: ["example.com"],
		exclude_domains: ["old.example.com"],
	});
	assert.deepEqual(hits, [{
		title: "Guide",
		url: "https://docs.example.com/guide",
		snippet: "A guide",
		publishedAt: null,
		score: 0.8,
	}]);
});

test("Firecrawl adapter translates the shared request and response", async () => {
	let requestBody: unknown;
	const fetchFn: FetchLike = async (_input, init) => {
		requestBody = JSON.parse(String(init?.body));
		return jsonResponse({ data: { web: [{ title: "Release", url: "https://example.com/release", description: "Released", publishedDate: "2026-01-01" }] } });
	};
	const provider = new FirecrawlSearchProvider("test-key", fetchFn);

	const hits = await provider.search({ query: "release", limit: 4, domains: { include: ["example.com"] } });

	assert.deepEqual(requestBody, {
		query: "release",
		limit: 4,
		sources: ["web"],
		includeDomains: ["example.com"],
	});
	assert.deepEqual(hits, [{
		title: "Release",
		url: "https://example.com/release",
		snippet: "Released",
		publishedAt: "2026-01-01",
		score: null,
	}]);
});

test("DuckDuckGo adapter decodes redirect URLs and strips result markup", async () => {
	const html = `
		<body>
			<div class="result results_links">
				<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide%3Futm_source%3Dddg">Example &amp; Guide</a>
				<a class="result__snippet"><b>Useful</b> guide &quot;excerpt&quot;</a>
			</div>
		</body>`;
	const fetchFn: FetchLike = async () => new Response(html, { status: 200 });

	const hits = await new DuckDuckGoSearchProvider(fetchFn).search({ query: "guide", limit: 1 });

	assert.deepEqual(hits, [{
		title: "Example & Guide",
		url: "https://example.com/guide?utm_source=ddg",
		snippet: "Useful guide \"excerpt\"",
	}]);
});

test("configured adapters propagate parent cancellation to fetch", async () => {
	let receivedSignal: AbortSignal | undefined;
	const fetchFn: FetchLike = async (_input, init) => {
		receivedSignal = init?.signal as AbortSignal;
		return new Promise((_resolve, reject) => receivedSignal?.addEventListener("abort", () => reject(receivedSignal?.reason), { once: true }));
	};
	const controller = new AbortController();
	const pending = new TavilySearchProvider("test-key", fetchFn).search({ query: "cancel" }, controller.signal);
	setImmediate(() => controller.abort(new DOMException("Cancelled", "AbortError")));

	await assert.rejects(pending, { name: "AbortError" });
	assert.equal(receivedSignal?.aborted, true);
});
