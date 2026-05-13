import { createHash } from "node:crypto";

export interface StablePrefixSnapshot {
	hash: string;
	chars: number;
	estimatedTokens: number;
	parts: {
		customPromptHash?: string;
		appendSystemPromptHash?: string;
		toolSnippetsHash: string;
		promptGuidelinesHash: string;
		contextFilesHash: string;
		skillsRegistryHash: string;
		selectedToolsHash: string;
	};
	counts: {
		selectedTools: number;
		contextFiles: number;
		skills: number;
	};
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function stableJson(value: unknown): string {
	return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortValue);
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortValue(record[key])]));
}

export function buildStablePrefixSnapshot(options: any): StablePrefixSnapshot {
	const selectedTools = Array.isArray(options?.selectedTools) ? [...options.selectedTools].sort() : [];
	const toolSnippets = options?.toolSnippets && typeof options.toolSnippets === "object"
		? Object.fromEntries(Object.entries(options.toolSnippets).sort(([a], [b]) => a.localeCompare(b)))
		: {};
	const promptGuidelines = Array.isArray(options?.promptGuidelines) ? [...options.promptGuidelines] : [];
	const contextFiles = Array.isArray(options?.contextFiles)
		? options.contextFiles
				.map((file: { path?: string; content?: string }) => ({ path: file.path ?? "", contentHash: sha256(file.content ?? ""), chars: (file.content ?? "").length }))
				.sort((a, b) => a.path.localeCompare(b.path))
		: [];
	const skills = Array.isArray(options?.skills)
		? options.skills
				.map((skill: { name?: string; description?: string; filePath?: string }) => ({
					name: skill.name ?? "",
					description: skill.description ?? "",
					filePath: skill.filePath ?? "",
				}))
				.sort((a, b) => `${a.name}:${a.filePath}`.localeCompare(`${b.name}:${b.filePath}`))
		: [];

	const stablePrefix = stableJson({
		customPrompt: options?.customPrompt ?? "",
		appendSystemPrompt: options?.appendSystemPrompt ?? "",
		selectedTools,
		toolSnippets,
		promptGuidelines,
		contextFiles,
		skills,
	});

	return {
		hash: sha256(stablePrefix),
		chars: stablePrefix.length,
		estimatedTokens: estimateTextTokens(stablePrefix),
		parts: {
			customPromptHash: options?.customPrompt ? sha256(String(options.customPrompt)) : undefined,
			appendSystemPromptHash: options?.appendSystemPrompt ? sha256(String(options.appendSystemPrompt)) : undefined,
			toolSnippetsHash: sha256(stableJson(toolSnippets)),
			promptGuidelinesHash: sha256(stableJson(promptGuidelines)),
			contextFilesHash: sha256(stableJson(contextFiles)),
			skillsRegistryHash: sha256(stableJson(skills)),
			selectedToolsHash: sha256(stableJson(selectedTools)),
		},
		counts: {
			selectedTools: selectedTools.length,
			contextFiles: contextFiles.length,
			skills: skills.length,
		},
	};
}

export function summarizePrefixStability(hashes: string[]): { total: number; unique: number; stable: boolean; changes: number } {
	const unique = new Set(hashes);
	let changes = 0;
	for (let i = 1; i < hashes.length; i += 1) {
		if (hashes[i] !== hashes[i - 1]) changes += 1;
	}
	return { total: hashes.length, unique: unique.size, stable: unique.size <= 1, changes };
}
