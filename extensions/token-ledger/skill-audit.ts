import { readFileSync, statSync } from "node:fs";

export interface SkillInfo {
	name?: string;
	description?: string;
	filePath?: string;
	baseDir?: string;
	disableModelInvocation?: boolean;
}

export interface SkillAuditItem {
	name: string;
	filePath: string;
	descriptionTokens: number;
	registryTokens: number;
	bodyTokens: number;
	bodyChars: number;
	issues: string[];
}

export interface SkillAuditSummary {
	items: SkillAuditItem[];
	totalRegistryTokens: number;
	totalBodyTokens: number;
	missingDescriptions: number;
	hugeSkills: number;
}

function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function stripFrontmatter(text: string): string {
	if (!text.startsWith("---")) return text;
	const end = text.indexOf("\n---", 3);
	if (end === -1) return text;
	return text.slice(end + 4).trimStart();
}

function safeRead(path: string): string {
	try {
		if (!statSync(path).isFile()) return "";
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function auditOne(skill: SkillInfo): SkillAuditItem {
	const name = skill.name || "(unnamed)";
	const filePath = skill.filePath || "";
	const description = skill.description || "";
	const raw = filePath ? safeRead(filePath) : "";
	const body = stripFrontmatter(raw);
	const registry = `${name}\n${description}\n${filePath}`;
	const issues: string[] = [];
	if (!description.trim()) issues.push("missing description");
	if (description.trim().length < 40) issues.push("description likely too vague");
	if (description.length > 500) issues.push("description too long for routing registry");
	if (!raw) issues.push("skill file unreadable");
	if (estimateTextTokens(body) > 1500) issues.push("large skill body; split into progressive references");
	if (/examples?\//i.test(body) || /reference/i.test(body)) issues.push("contains examples/references; verify not always needed");
	if (/always|whenever|must use/i.test(description) && description.length > 120) issues.push("broad routing language; may over-trigger");
	return {
		name,
		filePath,
		descriptionTokens: estimateTextTokens(description),
		registryTokens: estimateTextTokens(registry),
		bodyTokens: estimateTextTokens(body),
		bodyChars: body.length,
		issues,
	};
}

export function auditSkills(skills: SkillInfo[]): SkillAuditSummary {
	const items = skills.map(auditOne).sort((a, b) => b.bodyTokens - a.bodyTokens);
	return {
		items,
		totalRegistryTokens: items.reduce((sum, item) => sum + item.registryTokens, 0),
		totalBodyTokens: items.reduce((sum, item) => sum + item.bodyTokens, 0),
		missingDescriptions: items.filter((item) => item.issues.includes("missing description")).length,
		hugeSkills: items.filter((item) => item.bodyTokens > 1500).length,
	};
}

export function formatSkillAudit(summary: SkillAuditSummary): string {
	if (summary.items.length === 0) return "Skill audit: no skills loaded.";
	const lines = [
		"Skill audit",
		`skills=${summary.items.length}, registry≈${summary.totalRegistryTokens.toLocaleString()} tokens, fullBodies≈${summary.totalBodyTokens.toLocaleString()} tokens`,
		`missingDescriptions=${summary.missingDescriptions}, largeSkills=${summary.hugeSkills}`,
		"Top skills by body size:",
	];
	for (const item of summary.items.slice(0, 12)) {
		lines.push(`- ${item.name}: body≈${item.bodyTokens.toLocaleString()} tokens, registry≈${item.registryTokens.toLocaleString()} tokens${item.issues.length ? ` [${item.issues.join("; ")}]` : ""}`);
		if (item.filePath) lines.push(`  ${item.filePath}`);
	}
	if (summary.items.length > 12) lines.push(`... ${summary.items.length - 12} more skills omitted`);
	lines.push("Recommendation: keep prompt registry to name+description+path; load full SKILL.md only when routed or explicit /skill:name is used.");
	return lines.join("\n");
}
