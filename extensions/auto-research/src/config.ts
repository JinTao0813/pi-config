import path from "node:path";

export interface AutoResearchConfig {
	artifactRoot: string;
	maxSources: number;
	webProvider: "tavily" | "duckduckgo" | "none";
	tavilyApiKeyEnv: string;
}

export function loadConfig(cwd = process.cwd()): AutoResearchConfig {
	return {
		artifactRoot: process.env.PI_AUTO_RESEARCH_DIR || path.join(process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || cwd, ".pi", "agent"), "research"),
		maxSources: Number(process.env.PI_AUTO_RESEARCH_MAX_SOURCES || 8),
		webProvider: (process.env.PI_AUTO_RESEARCH_WEB_PROVIDER as AutoResearchConfig["webProvider"]) || (process.env.TAVILY_API_KEY ? "tavily" : "duckduckgo"),
		tavilyApiKeyEnv: process.env.PI_AUTO_RESEARCH_TAVILY_ENV || "TAVILY_API_KEY",
	};
}
