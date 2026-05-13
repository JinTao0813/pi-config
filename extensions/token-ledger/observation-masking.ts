export interface MaskingCandidate {
	entryId?: string;
	toolName: string;
	chars: number;
	estimatedTokens: number;
	estimatedMaskedTokens: number;
	estimatedSavedTokens: number;
	reason: string;
}

export interface MaskingAuditSummary {
	candidates: MaskingCandidate[];
	totalCandidates: number;
	estimatedSavedTokens: number;
	byTool: Record<string, { count: number; savedTokens: number }>;
}

function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((block) => {
		if (block && typeof block === "object" && "type" in block && (block as { type?: unknown }).type === "text" && "text" in block) {
			return String((block as { text?: unknown }).text ?? "");
		}
		return "[image]";
	}).join("\n");
}

function shouldPreserveExact(toolName: string, input: Record<string, unknown>, isError: boolean, text: string): string | undefined {
	if (isError) return "error-result";
	if (toolName === "read" && (input.offset !== undefined || input.limit !== undefined)) return "explicit-read-range";
	if (toolName === "read" && text.split("\n").length <= 80) return "small-read";
	if (/error|failed|exception|traceback|panic/i.test(text) && text.length < 20_000) return "important-error-context";
	return undefined;
}

function maskedTokenEstimate(toolName: string, text: string): number {
	const lines = text.split("\n");
	if (toolName === "bash") return estimateTextTokens(lines.slice(0, 4).join("\n") + "\n" + lines.slice(-20).join("\n")) + 80;
	if (toolName === "read") return 120;
	if (toolName === "grep" || toolName === "find" || toolName === "ls") return Math.min(estimateTextTokens(text), 300);
	return Math.min(estimateTextTokens(text), 500);
}

export function auditObservationMasking(entries: unknown[], options: { keepRecentEntries?: number } = {}): MaskingAuditSummary {
	const keepRecentEntries = options.keepRecentEntries ?? 12;
	const candidates: MaskingCandidate[] = [];
	const eligibleEntries = entries.slice(0, Math.max(0, entries.length - keepRecentEntries));
	for (const entry of eligibleEntries) {
		if (!entry || typeof entry !== "object") continue;
		const record = entry as Record<string, unknown>;
		if (record.type !== "message") continue;
		const message = record.message as Record<string, unknown> | undefined;
		if (!message || message.role !== "toolResult") continue;
		const toolName = String(message.toolName ?? "unknown");
		const input = (message.details && typeof message.details === "object" && "input" in message.details)
			? (message.details as Record<string, unknown>).input as Record<string, unknown>
			: {};
		const text = textFromContent(message.content);
		const tokens = estimateTextTokens(text);
		if (tokens < 800) continue;
		const preserve = shouldPreserveExact(toolName, input, Boolean(message.isError), text);
		if (preserve) continue;
		const masked = maskedTokenEstimate(toolName, text);
		const saved = Math.max(0, tokens - masked);
		if (saved < 400) continue;
		candidates.push({
			entryId: typeof record.id === "string" ? record.id : undefined,
			toolName,
			chars: text.length,
			estimatedTokens: tokens,
			estimatedMaskedTokens: masked,
			estimatedSavedTokens: saved,
			reason: "old-large-tool-result",
		});
	}
	const byTool: Record<string, { count: number; savedTokens: number }> = {};
	for (const candidate of candidates) {
		byTool[candidate.toolName] ??= { count: 0, savedTokens: 0 };
		byTool[candidate.toolName].count += 1;
		byTool[candidate.toolName].savedTokens += candidate.estimatedSavedTokens;
	}
	return {
		candidates: candidates.sort((a, b) => b.estimatedSavedTokens - a.estimatedSavedTokens),
		totalCandidates: candidates.length,
		estimatedSavedTokens: candidates.reduce((sum, c) => sum + c.estimatedSavedTokens, 0),
		byTool,
	};
}

export function formatMaskingAudit(summary: MaskingAuditSummary): string {
	if (summary.totalCandidates === 0) return "Observation masking audit: no eligible old large tool results found.";
	const lines = [
		"Observation masking audit (simulation only)",
		`candidates=${summary.totalCandidates}, potentialSavings≈${summary.estimatedSavedTokens.toLocaleString()} tokens`,
		"By tool:",
	];
	for (const [tool, stats] of Object.entries(summary.byTool).sort((a, b) => b[1].savedTokens - a[1].savedTokens)) {
		lines.push(`- ${tool}: count=${stats.count}, savings≈${stats.savedTokens.toLocaleString()} tokens`);
	}
	lines.push("Top candidates:");
	for (const candidate of summary.candidates.slice(0, 10)) {
		lines.push(`- ${candidate.toolName} ${candidate.entryId ?? ""}: ${candidate.estimatedTokens.toLocaleString()} -> ${candidate.estimatedMaskedTokens.toLocaleString()} tokens, save≈${candidate.estimatedSavedTokens.toLocaleString()}`);
	}
	lines.push("Recommendation: implement core masking before LLM compaction only after this audit shows meaningful savings on real sessions.");
	return lines.join("\n");
}
