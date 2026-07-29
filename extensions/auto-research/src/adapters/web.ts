import crypto from "node:crypto";
import { getEnv } from "../../../shared/env.ts";
import { createDefaultSearchEngine } from "../../../web-research/defaults.ts";
import type { SearchRequest, SearchResponse } from "../../../web-research/types.ts";
import type { AutoResearchConfig } from "../config.ts";
import { gradeEvidence } from "../engine/grader.ts";
import type { Evidence, SearchTask } from "../engine/schemas.ts";

interface SearchClient {
	search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse>;
}

export async function searchWeb(
	task: SearchTask,
	config: AutoResearchConfig,
	signal?: AbortSignal,
	client: SearchClient = createDefaultSearchEngine({
		tavilyApiKey: getEnv("TAVILY_API_KEY"),
		firecrawlApiKey: getEnv("FIRECRAWL_API_KEY"),
	}),
): Promise<Evidence[]> {
	if (!config.webSearchEnabled) return [];
	const result = await client.search({
		query: task.query,
		depth: "quick",
		limit: Math.max(1, Math.min(10, config.maxSources)),
	}, signal);
	return result.sources.map((source) => gradeEvidence({
		id: crypto.createHash("sha1").update(`${source.url}:${task.id}`).digest("hex").slice(0, 10),
		title: source.title,
		url: source.url,
		sourceType: "web",
		snippet: source.excerpt,
		retrievalQuery: task.query,
		fetchedAt: new Date().toISOString(),
		provider: result.providerUsed ?? undefined,
		publishedAt: source.publishedAt ?? undefined,
	}));
}
