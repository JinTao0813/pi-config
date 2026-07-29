import { runWithTimeout } from "../timeout.ts";
import type { SearchHit, SearchProvider, SearchRequest } from "../types.ts";
import { assertRecord, optionalString, ProviderHttpError, readJson, requestLimit, type FetchLike } from "./provider.ts";

export class FirecrawlSearchProvider implements SearchProvider {
	readonly name = "firecrawl" as const;
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
		if (!this.apiKey) throw new Error("Firecrawl is not configured");
		return runWithTimeout(signal, 30_000, async (requestSignal) => {
			const response = await this.fetchFn("https://api.firecrawl.dev/v2/search", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					query: request.query,
					limit: requestLimit(request),
					sources: ["web"],
					includeDomains: request.domains?.include?.length ? request.domains.include : undefined,
					excludeDomains: request.domains?.exclude?.length ? request.domains.exclude : undefined,
				}),
				signal: requestSignal,
			});
			if (!response.ok) throw new ProviderHttpError("Firecrawl", response.status);
			const json = await readJson(response, "Firecrawl");
			if (json.success === false) throw new Error("Firecrawl search failed");
			const data = assertRecord(json.data, "Firecrawl");
			if (!Array.isArray(data.web)) throw new Error("Firecrawl malformed response");
			return data.web.map(toSearchHit);
		});
	}
}

function toSearchHit(value: unknown): SearchHit {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const row = value as Record<string, unknown>;
	return {
		title: optionalString(row.title),
		url: optionalString(row.url),
		snippet: optionalString(row.description),
		publishedAt: optionalString(row.publishedDate) ?? optionalString(row.published_date),
		score: typeof row.score === "number" ? row.score : null,
	};
}
