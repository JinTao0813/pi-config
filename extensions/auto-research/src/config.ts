import path from "node:path";
import { getEnv } from "../../lib/env";

export interface AutoResearchConfig {
	artifactRoot: string;
	maxSources: number;
	webProvider: "tavily" | "duckduckgo" | "none";
	tavilyApiKeyEnv: string;
}

export function loadConfig(cwd = process.cwd()): AutoResearchConfig {
	const agentDir = getEnv("PI_CODING_AGENT_DIR") || path.join(process.env.HOME || cwd, ".pi", "agent");
	return {
		artifactRoot: getEnv("PI_AUTO_RESEARCH_DIR") || path.join(agentDir, "research"),
		maxSources: Number(getEnv("PI_AUTO_RESEARCH_MAX_SOURCES") || 8),
		webProvider: (getEnv("PI_AUTO_RESEARCH_WEB_PROVIDER") as AutoResearchConfig["webProvider"]) || (getEnv("TAVILY_API_KEY") ? "tavily" : "duckduckgo"),
		tavilyApiKeyEnv: getEnv("PI_AUTO_RESEARCH_TAVILY_ENV") || "TAVILY_API_KEY",
	};
}
