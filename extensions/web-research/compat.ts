export function prepareWebResearchArguments(args: unknown): unknown {
	if (!args || typeof args !== "object" || Array.isArray(args)) return args;
	const legacy = args as Record<string, unknown>;
	const currentDomains = legacy.domains && typeof legacy.domains === "object" && !Array.isArray(legacy.domains)
		? legacy.domains as Record<string, unknown>
		: {};
	const include = uniqueStrings(currentDomains.include, legacy.requiredDomains);
	const exclude = uniqueStrings(currentDomains.exclude, legacy.blockedDomains);
	const depth = legacy.depth ?? (legacy.includeRawContent === true ? "read" : undefined);
	const limit = legacy.limit ?? legacy.maxSources ?? legacy.maxResults;
	const recency = legacy.recency === "any" ? undefined : legacy.recency;
	const domains = {
		...(include.length ? { include } : {}),
		...(exclude.length ? { exclude } : {}),
	};

	return {
		query: legacy.query,
		...(depth !== undefined ? { depth } : {}),
		...(limit !== undefined ? { limit } : {}),
		...(recency !== undefined ? { recency } : {}),
		...(Object.keys(domains).length ? { domains } : {}),
	};
}

function uniqueStrings(...values: unknown[]): string[] {
	const output: string[] = [];
	for (const value of values) {
		if (!Array.isArray(value)) continue;
		for (const item of value) {
			if (typeof item === "string" && !output.includes(item)) output.push(item);
		}
	}
	return output;
}
