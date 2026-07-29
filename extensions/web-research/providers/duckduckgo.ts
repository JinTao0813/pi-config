import { runWithTimeout } from "../timeout.ts";
import type { SearchHit, SearchProvider, SearchRequest } from "../types.ts";
import { ProviderHttpError, requestLimit, type FetchLike } from "./provider.ts";

export class DuckDuckGoSearchProvider implements SearchProvider {
	readonly name = "duckduckgo" as const;
	private readonly fetchFn: FetchLike;

	constructor(fetchFn: FetchLike = fetch) {
		this.fetchFn = fetchFn;
	}

	isAvailable(): boolean {
		return true;
	}

	async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchHit[]> {
		return runWithTimeout(signal, 15_000, async (requestSignal) => {
			const url = new URL("https://html.duckduckgo.com/html/");
			url.searchParams.set("q", request.query);
			const response = await this.fetchFn(url, {
				headers: {
					Accept: "text/html",
					"User-Agent": "pi-coding-agent-web-research/1.0",
				},
				signal: requestSignal,
			});
			if (!response.ok) throw new ProviderHttpError("DuckDuckGo", response.status);
			return parseDuckDuckGoHtml(await response.text(), requestLimit(request));
		});
	}
}

export function parseDuckDuckGoHtml(html: string, limit: number): SearchHit[] {
	const blocks = html.match(/<div[^>]+class="[^"]*result[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*result[^"]*"|<\/body>|$)/gi) ?? [];
	const hits: SearchHit[] = [];
	for (const block of blocks) {
		const link = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
		if (!link) continue;
		const url = normalizeDuckDuckGoUrl(link[1]);
		if (!url) continue;
		const snippet = block.match(/<([a-z][\w:-]*)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/\1>/i);
		hits.push({ title: cleanHtml(link[2]), url, snippet: cleanHtml(snippet?.[2] ?? "") });
		if (hits.length >= limit) break;
	}
	return hits;
}

function normalizeDuckDuckGoUrl(raw: string): string | null {
	try {
		const url = new URL(decodeHtml(raw), "https://duckduckgo.com");
		return url.searchParams.get("uddg") ?? (url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null);
	} catch {
		return null;
	}
}

function cleanHtml(input: string): string {
	return decodeHtml(input.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeHtml(input: string): string {
	const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"" };
	return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
		if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? match;
		const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
		const raw = radix === 16 ? entity.slice(2) : entity.slice(1);
		const codePoint = Number.parseInt(raw, radix);
		try { return String.fromCodePoint(codePoint); } catch { return match; }
	});
}
