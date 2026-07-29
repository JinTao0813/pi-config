import { processHits } from "./normalize.ts";
import type {
	ProviderName,
	ResearchSource,
	SearchAttempt,
	SearchErrorCategory,
	SearchProvider,
	SearchRequest,
	SearchResponse,
} from "./types.ts";

export class SearchCancelledError extends Error {
	readonly attempts: SearchAttempt[];

	constructor(attempts: SearchAttempt[], cause?: unknown) {
		super("Web search was cancelled", { cause });
		this.name = "SearchCancelledError";
		this.attempts = attempts;
	}
}

export function categorizeSearchError(error: unknown, signal?: AbortSignal): SearchErrorCategory {
	const value = error as { name?: string; message?: string; status?: number; statusCode?: number } | null;
	const message = value?.message?.toLowerCase() ?? "";
	const status = value?.status ?? value?.statusCode;
	if (signal?.aborted || value?.name === "AbortError") return "cancelled";
	if (value?.name === "TimeoutError" || /timed? out|timeout/.test(message)) return "timeout";
	if (status === 429 || /http\s*429|rate[ -]?limit/.test(message)) return "rate_limit";
	if (typeof status === "number" || /http\s*[45]\d\d/.test(message)) return "http";
	if (/malformed|invalid (?:json|response)|unexpected token/.test(message)) return "malformed_response";
	if (value instanceof TypeError || /network|fetch failed|econn|enotfound|socket/.test(message)) return "network";
	return "unknown";
}

export class SearchEngine {
	private readonly providers: readonly SearchProvider[];

	constructor(providers: readonly SearchProvider[]) {
		this.providers = providers;
	}

	async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
		const query = request.query.trim();
		if (!query) throw new TypeError("Search query must not be empty");
		if (query.length > 2_000) throw new TypeError("Search query must not exceed 2000 characters");
		if (signal?.aborted) throw new SearchCancelledError([], signal.reason);

		const requestedLimit = typeof request.limit === "number" && Number.isFinite(request.limit) ? Math.floor(request.limit) : 5;
		const limit = Math.max(1, Math.min(10, requestedLimit));
		const normalizedRequest = { ...request, query, limit };
		const attempts: SearchAttempt[] = [];
		let best: { provider: ProviderName; sources: ResearchSource[] } | null = null;

		for (const [index, provider] of this.providers.entries()) {
			if (!provider.isAvailable()) {
				attempts.push({ provider: provider.name, status: "unavailable", rawCount: 0, acceptedCount: 0, elapsedMs: 0 });
				continue;
			}

			const started = performance.now();
			try {
				const result = await provider.search(normalizedRequest, signal);
				if (signal?.aborted) {
					const attempt = cancelledAttempt(provider.name, started);
					attempts.push(attempt);
					throw new SearchCancelledError(attempts, signal.reason);
				}
				const rows = Array.isArray(result) ? result : [];
				const sources = processHits(rows, normalizedRequest);
				if (sources.length > 0 && (!best || sources.length > best.sources.length)) best = { provider: provider.name, sources };
				const hasLaterProvider = this.providers.slice(index + 1).some((candidate) => candidate.isAvailable());
				const minimum = Math.min(2, limit);
				const sufficient = sources.length >= minimum || (!hasLaterProvider && sources.length > 0);
				attempts.push({
					provider: provider.name,
					status: sufficient ? "success" : "insufficient",
					rawCount: rows.length,
					acceptedCount: sources.length,
					elapsedMs: elapsed(started),
				});
				if (sufficient) {
					return {
						query,
						providerUsed: provider.name,
						fallbackUsed: attempts.length > 1,
						sources,
						attempts,
					};
				}
			} catch (error) {
				if (error instanceof SearchCancelledError) throw error;
				const category = categorizeSearchError(error, signal);
				const attempt: SearchAttempt = {
					provider: provider.name,
					status: category === "cancelled" ? "cancelled" : "error",
					rawCount: 0,
					acceptedCount: 0,
					elapsedMs: elapsed(started),
					errorCategory: category,
				};
				attempts.push(attempt);
				if (category === "cancelled") throw new SearchCancelledError(attempts, error);
			}
		}

		return {
			query,
			providerUsed: best?.provider ?? null,
			fallbackUsed: attempts.length > 1,
			sources: best?.sources ?? [],
			attempts,
		};
	}
}

function elapsed(started: number): number {
	return Math.max(0, Math.round(performance.now() - started));
}

function cancelledAttempt(provider: SearchProvider["name"], started: number): SearchAttempt {
	return {
		provider,
		status: "cancelled",
		rawCount: 0,
		acceptedCount: 0,
		elapsedMs: elapsed(started),
		errorCategory: "cancelled",
	};
}
