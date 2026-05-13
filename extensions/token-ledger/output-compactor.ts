import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export interface ToolOutputCompactionMetadata {
	applied: boolean;
	techniques: string[];
	lossy: boolean;
	originalChars: number;
	compactedChars: number;
	originalLines: number;
	compactedLines: number;
	originalTokens: number;
	compactedTokens: number;
	savedTokens: number;
	savedPercent: number;
	preserveReason?: string;
}

export interface ToolOutputCompactionOutcome {
	changed: boolean;
	content?: unknown[];
	metadata?: ToolOutputCompactionMetadata;
}

interface TextBlock {
	type: string;
	text?: string;
	[key: string]: unknown;
}

const DEFAULT_MAX_CHARS = 12_000;
const EXACT_READ_LINE_THRESHOLD = 80;
const ERROR_RE = /(?:error|failed|failure|exception|traceback|panic|fatal|warning|\bERR!\b|✖|❌)/i;
const ANSI_RE = /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function countLines(text: string): number {
	if (!text) return 0;
	return text.endsWith("\n") ? text.slice(0, -1).split("\n").length : text.split("\n").length;
}

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function normalizePathForComparison(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

function isPathUnderRoot(targetPath: string, rootPath: string): boolean {
	const target = normalizePathForComparison(resolve(targetPath));
	const root = normalizePathForComparison(resolve(rootPath));
	if (target === root) return true;
	const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
	return target.startsWith(rootWithSep);
}

function isUnderAncestorAgentsSkills(targetPath: string): boolean {
	let current = resolve(process.cwd());
	while (true) {
		if (isPathUnderRoot(targetPath, join(current, ".agents", "skills"))) return true;
		const parent = dirname(current);
		if (parent === current) return false;
		current = parent;
	}
}

function isSkillReadPath(filePath: string): boolean {
	if (!filePath.trim()) return false;
	const resolved = resolve(filePath);
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	return (
		isPathUnderRoot(resolved, join(agentDir, "skills")) ||
		isPathUnderRoot(resolved, join(homedir(), ".agents", "skills")) ||
		isPathUnderRoot(resolved, join(process.cwd(), ".pi", "skills")) ||
		isUnderAncestorAgentsSkills(resolved)
	);
}

function hasExplicitReadRange(input: Record<string, unknown>): boolean {
	return input.offset !== undefined || input.limit !== undefined;
}

function truncatePreservingSignals(text: string, maxChars = DEFAULT_MAX_CHARS): string {
	if (text.length <= maxChars) return text;
	const lines = text.split("\n");
	const signalLines = lines.filter((line) => ERROR_RE.test(line)).slice(-80);
	const head = lines.slice(0, 80);
	const tail = lines.slice(-120);
	let next = [
		`[Pi compacted output: truncated from ${text.length.toLocaleString()} chars to ~${maxChars.toLocaleString()} chars; preserved head/tail/error lines]`,
		...head,
		...(signalLines.length ? ["", "[Preserved error/warning lines]", ...signalLines] : []),
		"",
		`[... ${Math.max(0, lines.length - head.length - tail.length).toLocaleString()} lines omitted ...]`,
		...tail,
	].join("\n");
	if (next.length > maxChars) {
		const half = Math.floor((maxChars - 200) / 2);
		next = `${next.slice(0, half)}\n[... compacted further ...]\n${next.slice(-half)}`;
	}
	return next;
}

function compactTestOutput(text: string, command?: string): string | null {
	if (!command || !/\b(test|vitest|jest|playwright|bun test|pytest|cargo test|go test)\b/i.test(command)) return null;
	const lines = text.split("\n");
	if (lines.length < 80 && text.length < 8_000) return null;
	const important = lines.filter((line) => ERROR_RE.test(line) || /(?:tests?|specs?).*(?:pass|fail|failed|passed)|(?:pass|fail):|summary/i.test(line));
	if (important.length === 0) return null;
	return [
		`[Pi compacted test output: ${lines.length.toLocaleString()} lines -> ${important.length.toLocaleString()} important lines]`,
		...important.slice(0, 240),
		...(important.length > 240 ? [`[... ${important.length - 240} important lines omitted ...]`] : []),
	].join("\n");
}

function compactBuildOutput(text: string, command?: string): string | null {
	if (!command || !/\b(build|tsc|next|vite|webpack|rollup|cargo build|go build|npm run|pnpm)\b/i.test(command)) return null;
	const lines = text.split("\n");
	if (lines.length < 100 && text.length < 10_000) return null;
	const important = lines.filter((line) => ERROR_RE.test(line) || /\w+\.(ts|tsx|js|jsx|css|rs|go|py):\d+/i.test(line));
	if (important.length === 0) return null;
	return [
		`[Pi compacted build output: ${lines.length.toLocaleString()} lines -> ${important.length.toLocaleString()} error/warning lines]`,
		...important.slice(0, 240),
		...(important.length > 240 ? [`[... ${important.length - 240} important lines omitted ...]`] : []),
	].join("\n");
}

function compactGitOutput(text: string, command?: string): string | null {
	if (!command || !/^\s*git\s+/i.test(command)) return null;
	if (text.length < 8_000) return null;
	const lines = text.split("\n");
	const important = lines.filter((line) => /^(On branch|Changes|Untracked|modified:|new file:|deleted:|diff --git|@@|commit\s|Author:|Date:|\+\+\+|---)/.test(line.trim()));
	if (important.length === 0) return null;
	return [
		`[Pi compacted git output: ${lines.length.toLocaleString()} lines -> ${important.length.toLocaleString()} structural lines]`,
		...important.slice(0, 300),
		...(important.length > 300 ? [`[... ${important.length - 300} git lines omitted ...]`] : []),
	].join("\n");
}

function groupSearchOutput(text: string): string | null {
	const lines = text.split("\n").filter(Boolean);
	if (lines.length < 80) return null;
	const grouped = new Map<string, string[]>();
	for (const line of lines) {
		const match = line.match(/^([^:\n]+):(\d+):(.*)$/);
		if (!match) continue;
		const [, file, lineNo, rest] = match;
		const bucket = grouped.get(file) ?? [];
		if (bucket.length < 8) bucket.push(`${lineNo}:${rest}`);
		grouped.set(file, bucket);
	}
	if (grouped.size === 0) return null;
	const output = [`[Pi compacted search output: ${lines.length.toLocaleString()} matches grouped into ${grouped.size.toLocaleString()} files]`];
	for (const [file, matches] of grouped) {
		const count = lines.filter((line) => line.startsWith(`${file}:`)).length;
		output.push(`${file}: ${count} matches`);
		for (const match of matches) output.push(`  ${match}`);
		if (count > matches.length) output.push(`  ... ${count - matches.length} matches omitted`);
	}
	return output.join("\n");
}

function compactBash(text: string, input: Record<string, unknown>): { text: string; techniques: string[]; lossy: boolean } {
	let next = text;
	const techniques: string[] = [];
	let lossy = false;
	const command = typeof input.command === "string" ? input.command : undefined;
	const stripped = stripAnsi(next);
	if (stripped !== next) {
		next = stripped;
		techniques.push("ansi");
	}
	for (const [name, fn] of [
		["test", compactTestOutput],
		["build", compactBuildOutput],
		["git", compactGitOutput],
	] as const) {
		const compacted = fn(next, command);
		if (compacted && compacted.length < next.length) {
			next = compacted;
			techniques.push(name);
			lossy = true;
			break;
		}
	}
	const truncated = truncatePreservingSignals(next);
	if (truncated !== next) {
		next = truncated;
		techniques.push("truncate");
		lossy = true;
	}
	return { text: next, techniques, lossy };
}

function compactRead(text: string, input: Record<string, unknown>): { text: string; techniques: string[]; lossy: boolean; preserveReason?: string } {
	if (hasExplicitReadRange(input)) return { text, techniques: [], lossy: false, preserveReason: "explicit-read-range" };
	const filePath = typeof input.path === "string" ? input.path : "";
	if (isSkillReadPath(filePath)) return { text, techniques: [], lossy: false, preserveReason: "skill-read" };
	if (countLines(text) <= EXACT_READ_LINE_THRESHOLD) return { text, techniques: [], lossy: false, preserveReason: "small-read" };
	// Phase 2: no lossy read/source filtering. Only strip ANSI if present.
	const stripped = stripAnsi(text);
	if (stripped !== text) return { text: stripped, techniques: ["ansi"], lossy: false };
	return { text, techniques: [], lossy: false, preserveReason: "read-compaction-disabled" };
}

function compactSearch(text: string): { text: string; techniques: string[]; lossy: boolean } {
	let next = stripAnsi(text);
	const techniques = next !== text ? ["ansi"] : [];
	let lossy = false;
	const grouped = groupSearchOutput(next);
	if (grouped && grouped.length < next.length) {
		next = grouped;
		techniques.push("search");
		lossy = true;
	}
	const truncated = truncatePreservingSignals(next);
	if (truncated !== next) {
		next = truncated;
		techniques.push("truncate");
		lossy = true;
	}
	return { text: next, techniques, lossy };
}

export function compactToolOutput(event: { toolName: string; input: Record<string, unknown>; content: unknown[] }): ToolOutputCompactionOutcome {
	let changed = false;
	let lossy = false;
	let preserveReason: string | undefined;
	const techniques = new Set<string>();
	const originalTexts: string[] = [];
	const compactedTexts: string[] = [];

	const nextContent = event.content.map((block) => {
		if (!block || typeof block !== "object" || Array.isArray(block)) return block;
		const textBlock = block as TextBlock;
		if (textBlock.type !== "text" || typeof textBlock.text !== "string") return block;
		originalTexts.push(textBlock.text);
		let result: { text: string; techniques: string[]; lossy: boolean; preserveReason?: string } = { text: textBlock.text, techniques: [], lossy: false };
		if (event.toolName === "bash") result = compactBash(textBlock.text, event.input);
		else if (event.toolName === "read") result = compactRead(textBlock.text, event.input);
		else if (event.toolName === "grep" || event.toolName === "find" || event.toolName === "ls") result = compactSearch(textBlock.text);
		for (const technique of result.techniques) techniques.add(technique);
		lossy ||= result.lossy;
		preserveReason = preserveReason ?? result.preserveReason;
		compactedTexts.push(result.text);
		if (result.text !== textBlock.text) {
			changed = true;
			return { ...textBlock, text: result.text };
		}
		return block;
	});

	if (!changed) return { changed: false };
	const original = originalTexts.join("\n");
	const compacted = compactedTexts.join("\n");
	const originalTokens = estimateTextTokens(original);
	const compactedTokens = estimateTextTokens(compacted);
	return {
		changed: true,
		content: nextContent,
		metadata: {
			applied: true,
			techniques: Array.from(techniques),
			lossy,
			originalChars: original.length,
			compactedChars: compacted.length,
			originalLines: countLines(original),
			compactedLines: countLines(compacted),
			originalTokens,
			compactedTokens,
			savedTokens: Math.max(0, originalTokens - compactedTokens),
			savedPercent: originalTokens > 0 ? Math.round(((originalTokens - compactedTokens) / originalTokens) * 10_000) / 100 : 0,
			preserveReason,
		},
	};
}
