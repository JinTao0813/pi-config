import type { Depth, ResearchMode, ResearchPlan, SearchTask } from "./schemas";

export function createPlan(mode: ResearchMode, query: string, depth: Depth = "standard"): ResearchPlan {
	const base = mode === "deep_topic" ? deepTopicTasks(query) : opportunityTasks(query);
	const limit = depth === "quick" ? 3 : depth === "deep" ? base.length : 5;
	return { mode, query, depth, tasks: base.slice(0, limit) };
}

function deepTopicTasks(topic: string): SearchTask[] {
	return [
		{ id: "overview", query: `${topic} overview current state`, purpose: "Baseline concept map and terminology" },
		{ id: "official", query: `${topic} official documentation guide`, purpose: "Primary/official references" },
		{ id: "implementation", query: `${topic} implementation examples best practices`, purpose: "Practical implementation details" },
		{ id: "limitations", query: `${topic} limitations pitfalls tradeoffs`, purpose: "Risks and failure modes" },
		{ id: "recent", query: `${topic} 2026 recent changes release notes`, purpose: "Freshness check" },
		{ id: "comparison", query: `${topic} alternatives comparison`, purpose: "Adjacent options and competing approaches" },
	];
}

function opportunityTasks(idea: string): SearchTask[] {
	return [
		{ id: "pain", query: `${idea} customer pain points forum complaints`, purpose: "Pain evidence and user language" },
		{ id: "users", query: `${idea} target customers jobs to be done`, purpose: "Segments and JTBD" },
		{ id: "competitors", query: `${idea} competitors alternatives`, purpose: "Existing solutions" },
		{ id: "constraints", query: `${idea} operational constraints risks regulations`, purpose: "Execution constraints" },
		{ id: "market", query: `${idea} market size trends`, purpose: "Market context" },
		{ id: "validation", query: `${idea} MVP validation landing page interviews`, purpose: "Validation approaches" },
	];
}
