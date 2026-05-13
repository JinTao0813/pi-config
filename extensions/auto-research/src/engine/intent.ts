export interface IntentFrame {
	originalQuery: string;
	entity: string;
	domainHints: string[];
	includeTerms: string[];
	excludeTerms: string[];
	expectedSourceTypes: string[];
}

const AI_TERMS = ["agent", "agents", "ai", "llm", "autonomous", "multi-agent", "framework", "model", "tool", "application", "use case", "software"];
const COMMON_OFFTOPIC = ["heavy metal", "toxicity", "essential oils", "food preservation", "composites", "fibre", "fiber", "molecular docking", "nutraceutical", "vehicle", "motion prediction", "risk assessment", "environment"];

export function inferIntent(query: string): IntentFrame {
	const words = query.match(/[A-Za-z0-9_.-]+/g) || [];
	const acronym = words.find(w => /^[A-Z][A-Z0-9_-]{2,}$/.test(w));
	const lower = query.toLowerCase();
	const domainHints = AI_TERMS.filter(t => lower.includes(t));
	if (domainHints.some(t => ["agent", "agents", "llm", "ai", "autonomous", "multi-agent"].includes(t))) domainHints.push("AI", "LLM", "autonomous agent", "software");
	const entity = acronym ? `${acronym}${lower.includes("agent") ? " agent" : ""}`.trim() : words.slice(0, 3).join(" ");
	const includeTerms = Array.from(new Set([...(acronym ? [acronym] : []), ...words.filter(w => w.length > 2), ...domainHints])).slice(0, 16);
	const excludeTerms = domainHints.length ? COMMON_OFFTOPIC : [];
	return { originalQuery: query, entity, domainHints: Array.from(new Set(domainHints)), includeTerms, excludeTerms, expectedSourceTypes: ["paper", "preprint", "docs", "repo", "web"] };
}

export function expandQuery(base: string, intent: IntentFrame, taskId: string) {
	const e = intent.entity || base;
	const quoted = e.includes(" ") ? `"${e}"` : e;
	const ai = intent.domainHints.length ? "AI LLM autonomous agent" : "";
	if (taskId === "official") return `${quoted} ${ai} GitHub documentation official`;
	if (taskId === "implementation") return `${quoted} ${ai} framework implementation examples GitHub`;
	if (taskId === "recent") return `${quoted} ${ai} recent paper release`;
	if (taskId === "comparison") return `${quoted} ${ai} alternatives comparison`;
	return `${quoted} ${ai} applications use cases`;
}
