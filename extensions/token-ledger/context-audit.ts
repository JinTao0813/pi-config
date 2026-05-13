import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ContextFileInfo {
	path: string;
	content: string;
}

export interface ContextIndexFileEntry {
	hash: string;
	chars: number;
	estimatedTokens: number;
	summary: string;
	sections: string[];
}

export interface ContextIndex {
	version: 1;
	generatedAt: string;
	files: Record<string, ContextIndexFileEntry>;
}

export interface ContextAuditSummary {
	index: ContextIndex;
	totalFiles: number;
	totalTokens: number;
	largest: Array<{ path: string; estimatedTokens: number; chars: number; sections: string[] }>;
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function extractSections(content: string): string[] {
	const sections = content
		.split("\n")
		.map((line) => line.match(/^#{1,4}\s+(.+)$/)?.[1]?.trim())
		.filter((value): value is string => Boolean(value));
	return Array.from(new Set(sections)).slice(0, 30);
}

function extractSummary(content: string): string {
	const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
	const important = lines.filter((line) => /\b(must|should|required|test|build|lint|style|convention|rule|command|do not|never|always)\b/i.test(line));
	const selected = (important.length ? important : lines).slice(0, 8);
	return selected.join(" ").slice(0, 1000);
}

export function buildContextAudit(contextFiles: ContextFileInfo[]): ContextAuditSummary {
	const index: ContextIndex = { version: 1, generatedAt: new Date().toISOString(), files: {} };
	for (const file of contextFiles) {
		index.files[file.path] = {
			hash: sha256(file.content),
			chars: file.content.length,
			estimatedTokens: estimateTextTokens(file.content),
			summary: extractSummary(file.content),
			sections: extractSections(file.content),
		};
	}
	const largest = Object.entries(index.files)
		.map(([path, entry]) => ({ path, estimatedTokens: entry.estimatedTokens, chars: entry.chars, sections: entry.sections }))
		.sort((a, b) => b.estimatedTokens - a.estimatedTokens)
		.slice(0, 12);
	return {
		index,
		totalFiles: Object.keys(index.files).length,
		totalTokens: Object.values(index.files).reduce((sum, entry) => sum + entry.estimatedTokens, 0),
		largest,
	};
}

export function writeContextIndex(cwd: string, index: ContextIndex): string {
	const dir = join(cwd, ".pi");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "context-index.json");
	writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
	return path;
}

export function formatContextAudit(summary: ContextAuditSummary, indexPath?: string): string {
	if (summary.totalFiles === 0) return "Context audit: no context files loaded.";
	const lines = [
		"Context audit",
		`files=${summary.totalFiles}, total≈${summary.totalTokens.toLocaleString()} tokens`,
		indexPath ? `index=${indexPath}` : "index=not written yet",
		"Largest context files:",
	];
	for (const item of summary.largest) {
		lines.push(`- ${item.path}: ≈${item.estimatedTokens.toLocaleString()} tokens, ${item.chars.toLocaleString()} chars${item.sections.length ? `, sections=${item.sections.slice(0, 5).join(" | ")}` : ""}`);
	}
	lines.push("Recommendation: use .pi/context-index.json as a stable manifest; inject summaries first, load full files/sections only when relevant.");
	return lines.join("\n");
}
