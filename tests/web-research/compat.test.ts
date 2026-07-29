import assert from "node:assert/strict";
import test from "node:test";

import { prepareWebResearchArguments } from "../../extensions/web-research/compat.ts";

test("legacy webResearch arguments are translated to the small contract", () => {
	const prepared = prepareWebResearchArguments({
		query: "release notes",
		maxResults: 9,
		maxSources: 4,
		requiredDomains: ["docs.example.com"],
		blockedDomains: ["blog.example.com"],
		includeRawContent: true,
		recency: "month",
		provider: "tavily",
		summaryMode: "detailed",
		confidenceThreshold: 0.8,
	});

	assert.deepEqual(prepared, {
		query: "release notes",
		depth: "read",
		limit: 4,
		recency: "month",
		domains: {
			include: ["docs.example.com"],
			exclude: ["blog.example.com"],
		},
	});
});

test("current arguments take precedence while legacy domains are merged", () => {
	const prepared = prepareWebResearchArguments({
		query: "api",
		depth: "quick",
		limit: 2,
		domains: { include: ["example.com"] },
		requiredDomains: ["docs.example.com", "example.com"],
		includeRawContent: true,
		recency: "any",
	});

	assert.deepEqual(prepared, {
		query: "api",
		depth: "quick",
		limit: 2,
		domains: { include: ["example.com", "docs.example.com"] },
	});
});
