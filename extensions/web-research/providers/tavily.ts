import { runWithTimeout } from "../timeout.ts";
import type { SearchHit, SearchProvider, SearchRequest } from "../types.ts";
import { optionalString, ProviderHttpError, readJson, requestLimit, type FetchLike } from "./provider.ts";

export class TavilySearchProvider implements SearchProvider {
	readonly name = "tavily" as const;
	private readonly apiKey: string | undefined;
	private readonly fetchFn: FetchLike;

	constructor(apiKey: string | undefined, fetchFn: FetchLike = fetch) {
		this.apiKey = apiKey?.trim() || undefined;
		this.fetchFn = fetchFn;
	}

	isAvailable(): boolean {
		return this.apiKey !== undefined;
	}

	async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchHit[]> {
		if (!this.apiKey) throw new Error("Tavily is not configured");
		return runWithTimeout(signal, 20_000, async (requestSignal) => {
			const response = await this.fetchFn("https://api.tavily.com/search", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					query: request.query,
					max_results: requestLimit(request),
					search_depth: "basic",
					include_answer: false,
					include_raw_content: false,
					topic: "general",
					time_range: request.recency,
					include_domains: request.domains?.include?.length ? request.domains.include : undefined,
					exclude_domains: request.domains?.exclude?.length ? request.domains.exclude : undefined,
				}),
				signal: requestSignal,
			});
			if (!response.ok) throw new ProviderHttpError("Tavily", response.status);
			const json = await readJson(response, "Tavily");
			if (!Array.isArray(json.results)) throw new Error("Tavily malformed response");
			return json.results.map(toSearchHit);
		});
	}
}

function toSearchHit(value: unknown): SearchHit {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const row = value as Record<string, unknown>;
	return {
		title: optionalString(row.title),
		url: optionalString(row.url),
		snippet: optionalString(row.content),
		publishedAt: optionalString(row.published_date),
		score: typeof row.score === "number" ? row.score : null,
	};
}
