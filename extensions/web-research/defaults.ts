import { SearchEngine } from "./engine.ts";
import { DuckDuckGoSearchProvider } from "./providers/duckduckgo.ts";
import { FirecrawlSearchProvider } from "./providers/firecrawl.ts";
import type { FetchLike } from "./providers/provider.ts";
import { TavilySearchProvider } from "./providers/tavily.ts";
import type { SearchProvider } from "./types.ts";

export interface DefaultSearchConfig {
	tavilyApiKey?: string;
	firecrawlApiKey?: string;
	fetchFn?: FetchLike;
}

export function createDefaultSearchEngine(config: DefaultSearchConfig = {}): SearchEngine {
	const providers: SearchProvider[] = [
		new TavilySearchProvider(config.tavilyApiKey, config.fetchFn),
		new FirecrawlSearchProvider(config.firecrawlApiKey, config.fetchFn),
		new DuckDuckGoSearchProvider(config.fetchFn),
	];
	return new SearchEngine(providers.filter((provider) => provider.isAvailable()));
}
