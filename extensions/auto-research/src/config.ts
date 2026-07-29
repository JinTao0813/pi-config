import path from "node:path";
import { getEnv } from "../../shared/env";

export interface AutoResearchConfig {
	artifactRoot: string;
	maxSources: number;
	webSearchEnabled: boolean;
}

export function loadConfig(cwd = process.cwd()): AutoResearchConfig {
	const agentDir = getEnv("PI_CODING_AGENT_DIR") || path.join(process.env.HOME || cwd, ".pi", "agent");
	return {
		artifactRoot: getEnv("PI_AUTO_RESEARCH_DIR") || path.join(agentDir, "research"),
		maxSources: Number(getEnv("PI_AUTO_RESEARCH_MAX_SOURCES") || 8),
		webSearchEnabled: getEnv("PI_AUTO_RESEARCH_WEB_PROVIDER") !== "none",
	};
}
