import assert from "node:assert/strict";
import test from "node:test";

import { searchWeb } from "../../extensions/auto-research/src/adapters/web.ts";
import type { SearchResponse } from "../../extensions/web-research/types.ts";

const config = {
	artifactRoot: "/tmp/research-test",
	maxSources: 8,
	webSearchEnabled: true,
} as const;

test("auto-research translates shared search sources into graded evidence", async () => {
	const response: SearchResponse = {
		query: "widget api",
		providerUsed: "firecrawl",
		fallbackUsed: false,
		attempts: [],
		sources: [{
			id: "[1]",
			title: "Official widget documentation",
			url: "https://docs.example.com/widget",
			excerpt: "Widget API reference",
			evidenceKind: "search-snippet",
			publishedAt: "2026-01-01",
			relevanceScore: 0.9,
		}],
	};
	const client = { search: async () => response };

	const evidence = await searchWeb(
		{ id: "task-1", query: "widget api", purpose: "Find docs" },
		config,
		undefined,
		client,
	);

	assert.equal(evidence.length, 1);
	assert.deepEqual({
		title: evidence[0]?.title,
		url: evidence[0]?.url,
		snippet: evidence[0]?.snippet,
		provider: evidence[0]?.provider,
		publishedAt: evidence[0]?.publishedAt,
		confidence: evidence[0]?.confidence,
	}, {
		title: "Official widget documentation",
		url: "https://docs.example.com/widget",
		snippet: "Widget API reference",
		provider: "firecrawl",
		publishedAt: "2026-01-01",
		confidence: "high",
	});
});
