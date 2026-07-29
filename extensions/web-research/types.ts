export type ProviderName = "tavily" | "firecrawl" | "duckduckgo";
export type SearchDepth = "quick" | "read";
export type SearchRecency = "day" | "week" | "month" | "year";

export interface SearchRequest {
	query: string;
	depth?: SearchDepth;
	limit?: number;
	recency?: SearchRecency;
	domains?: {
		include?: string[];
		exclude?: string[];
	};
}

/** Provider-owned row. Engine normalization treats every field as untrusted. */
export interface SearchHit {
	title?: string | null;
	url?: string | null;
	snippet?: string | null;
	publishedAt?: string | null;
	score?: number | null;
}

export interface SearchProvider {
	readonly name: ProviderName;
	isAvailable(): boolean;
	search(request: SearchRequest, signal?: AbortSignal): Promise<SearchHit[]>;
}

export type AttemptStatus = "success" | "insufficient" | "unavailable" | "error" | "cancelled";
export type SearchErrorCategory = "cancelled" | "timeout" | "rate_limit" | "http" | "malformed_response" | "network" | "unknown";

export interface SearchAttempt {
	provider: ProviderName;
	status: AttemptStatus;
	rawCount: number;
	acceptedCount: number;
	elapsedMs: number;
	errorCategory?: SearchErrorCategory;
}

export interface ResearchSource {
	id: `[${number}]`;
	title: string;
	url: string;
	excerpt: string;
	evidenceKind: "search-snippet";
	publishedAt: string | null;
	relevanceScore: number;
}

export interface SearchResponse {
	query: string;
	providerUsed: ProviderName | null;
	fallbackUsed: boolean;
	sources: ResearchSource[];
	attempts: SearchAttempt[];
}
