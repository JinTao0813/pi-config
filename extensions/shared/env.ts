import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let dotenvCache: Record<string, string> | null = null;

export function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

function parseDotenv(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (!match) continue;
		let value = match[2].trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
			if (match[2].trim().startsWith('"')) value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
		} else {
			value = value.replace(/\s+#.*$/, "");
		}
		out[match[1]] = value;
	}
	return out;
}

export function loadAgentDotenv(): Record<string, string> {
	if (dotenvCache) return dotenvCache;
	const file = join(agentDir(), ".env");
	try {
		dotenvCache = existsSync(file) ? parseDotenv(readFileSync(file, "utf8")) : {};
	} catch {
		dotenvCache = {};
	}
	return dotenvCache;
}

export function getEnv(name: string): string | undefined {
	const processValue = process.env[name]?.trim();
	if (processValue) return processValue;
	const fileValue = loadAgentDotenv()[name]?.trim();
	return fileValue || undefined;
}
