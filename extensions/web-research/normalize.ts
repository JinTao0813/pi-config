import type { ResearchSource, SearchHit, SearchRequest } from "./types.ts";

const TRACKING_PARAMETERS = new Set([
	"fbclid",
	"gclid",
	"mc_cid",
	"mc_eid",
	"ref",
]);

export function canonicalizeUrl(raw: string): string | null {
	if (raw.length > 2_048) return null;
	try {
		const url = new URL(raw);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		url.hash = "";
		for (const key of [...url.searchParams.keys()]) {
			if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
				url.searchParams.delete(key);
			}
		}
		url.searchParams.sort();
		if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
		return url.toString();
	} catch {
		return null;
	}
}

function normalizedDomain(raw: string): string {
	const value = raw.trim().toLowerCase();
	if (!value) return "";
	try {
		return new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "").replace(/^\.+|\.+$/g, "");
	} catch {
		return value.replace(/^www\./, "").replace(/^\.+|\.+$/g, "");
	}
}

export function domainMatches(url: string, domains: string[]): boolean {
	let hostname: string;
	try {
		hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return false;
	}
	return domains.some((raw) => {
		const domain = normalizedDomain(raw);
		return domain !== "" && (hostname === domain || hostname.endsWith(`.${domain}`));
	});
}

function terms(query: string): string[] {
	return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2))];
}

function relevance(hit: SearchHit, query: string): number {
	const queryTerms = terms(query);
	const text = `${hit.title ?? ""} ${hit.snippet ?? ""} ${hit.url ?? ""}`.toLowerCase();
	const lexical = queryTerms.length === 0 ? 0 : queryTerms.filter((term) => text.includes(term)).length / queryTerms.length;
	const providerScore = typeof hit.score === "number" && Number.isFinite(hit.score) ? Math.max(0, Math.min(1, hit.score)) : 0;
	return Number((lexical * 0.75 + providerScore * 0.25).toFixed(4));
}

export function processHits(rows: SearchHit[], request: SearchRequest): ResearchSource[] {
	const include = request.domains?.include ?? [];
	const exclude = request.domains?.exclude ?? [];
	const seen = new Set<string>();
	const accepted: Array<{ source: Omit<ResearchSource, "id">; index: number }> = [];

	for (const [index, row] of rows.entries()) {
		if (typeof row?.url !== "string") continue;
		const url = canonicalizeUrl(row.url);
		if (!url || (include.length > 0 && !domainMatches(url, include)) || domainMatches(url, exclude)) continue;
		const key = url.replace(/^https?:\/\/(?:www\.)?/i, "").toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const title = cleanText(typeof row.title === "string" && row.title.trim() ? row.title : url).slice(0, 300);
		const excerpt = cleanText(typeof row.snippet === "string" ? row.snippet : "").slice(0, 1_200);
		accepted.push({
			index,
			source: {
				title,
				url,
				excerpt,
				evidenceKind: "search-snippet",
				publishedAt: typeof row.publishedAt === "string" ? cleanText(row.publishedAt).slice(0, 100) : null,
				relevanceScore: relevance(row, request.query),
			},
		});
	}

	accepted.sort((a, b) => b.source.relevanceScore - a.source.relevanceScore || a.index - b.index);
	const limit = Math.max(1, Math.min(10, Math.floor(request.limit ?? 5)));
	return accepted.slice(0, limit).map(({ source }, index) => ({ ...source, id: `[${index + 1}]` as const }));
}

function cleanText(value: string): string {
	return value
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
