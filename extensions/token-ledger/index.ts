import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createHash } from "node:crypto";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { buildStablePrefixSnapshot, summarizePrefixStability, type StablePrefixSnapshot } from "./cache-metrics.ts";
import { buildContextAudit, formatContextAudit, writeContextIndex, type ContextAuditSummary, type ContextFileInfo } from "./context-audit.ts";
import { compactToolOutput } from "./output-compactor.ts";
import { auditObservationMasking, formatMaskingAudit } from "./observation-masking.ts";
import { auditSkills, formatSkillAudit, type SkillInfo } from "./skill-audit.ts";

type TokenLedgerEventKind =
	| "session_start"
	| "turn_start"
	| "turn_end"
	| "prompt_breakdown"
	| "provider_payload"
	| "provider_response"
	| "assistant_usage"
	| "tool_result";

interface TokenUsageRecord {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	costUsd: number;
}

interface PromptTokenBreakdown {
	system: number;
	customPrompt: number;
	appendSystemPrompt: number;
	promptGuidelines: number;
	toolSnippets: number;
	contextFiles: number;
	skillsRegistry: number;
	latestUser: number;
	unknown: number;
	estimated: true;
}

interface TokenLedgerEvent {
	timestamp: string;
	sessionId?: string;
	sessionFile?: string;
	turnIndex?: number;
	kind: TokenLedgerEventKind;
	provider?: string;
	model?: string;
	usage?: TokenUsageRecord;
	breakdown?: PromptTokenBreakdown;
	metadata?: Record<string, unknown>;
}

interface ToolStats {
	calls: number;
	chars: number;
	estimatedTokens: number;
	errors: number;
}

interface LedgerState {
	events: TokenLedgerEvent[];
	turnIndex?: number;
	outputPath?: string;
	latestBreakdown?: PromptTokenBreakdown;
	latestPayload?: Record<string, unknown>;
	latestStablePrefix?: StablePrefixSnapshot;
	stablePrefixHashes: string[];
	latestSkills: SkillInfo[];
	latestContextFiles: ContextFileInfo[];
	latestContextAudit?: ContextAuditSummary;
	latestContextIndexPath?: string;
	assistantUsage: TokenUsageRecord[];
	toolStats: Map<string, ToolStats>;
	providerResponses: number;
}

const state: LedgerState = {
	events: [],
	assistantUsage: [],
	toolStats: new Map(),
	providerResponses: 0,
	stablePrefixHashes: [],
	latestSkills: [],
	latestContextFiles: [],
};

function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function textOf(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string") {
					return (item as { text: string }).text;
				}
				return "";
			})
			.join("\n");
	}
	return "";
}

function countLines(text: string): number {
	if (!text) return 0;
	return text.endsWith("\n") ? text.slice(0, -1).split("\n").length : text.split("\n").length;
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(value, (key, val) => {
		const lowerKey = key.toLowerCase();
		if (lowerKey.includes("key") || lowerKey.includes("token") || lowerKey.includes("authorization")) {
			return "[redacted]";
		}
		if (typeof val === "string" && val.length > 20_000) {
			return `${val.slice(0, 20_000)}...[truncated ${val.length - 20_000} chars]`;
		}
		if (val && typeof val === "object") {
			if (seen.has(val)) return "[circular]";
			seen.add(val);
		}
		return val;
	});
}

function normalizeUsage(raw: unknown): TokenUsageRecord | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const usage = raw as Record<string, unknown>;
	const cost = usage.cost && typeof usage.cost === "object" ? (usage.cost as Record<string, unknown>) : {};
	const input = Number(usage.input ?? 0);
	const output = Number(usage.output ?? 0);
	const cacheRead = Number(usage.cacheRead ?? 0);
	const cacheWrite = Number(usage.cacheWrite ?? 0);
	const total = Number(usage.totalTokens ?? input + output + cacheRead + cacheWrite);
	const costUsd = Number(cost.total ?? 0);
	return { input, output, cacheRead, cacheWrite, total, costUsd };
}

function getSessionMetadata(ctx: ExtensionContext): Pick<TokenLedgerEvent, "sessionId" | "sessionFile"> {
	return {
		sessionId: ctx.sessionManager.getSessionId(),
		sessionFile: ctx.sessionManager.getSessionFile(),
	};
}

function ensureOutputPath(ctx: ExtensionContext): string {
	if (state.outputPath) return state.outputPath;
	const sessionDir = ctx.sessionManager.getSessionDir();
	const sessionId = ctx.sessionManager.getSessionId();
	const dir = join(sessionDir, "token-ledger");
	mkdirSync(dir, { recursive: true });
	state.outputPath = join(dir, `${sessionId}.jsonl`);
	return state.outputPath;
}

function record(ctx: ExtensionContext, event: Omit<TokenLedgerEvent, "timestamp" | "sessionId" | "sessionFile" | "turnIndex">): void {
	const fullEvent: TokenLedgerEvent = {
		timestamp: new Date().toISOString(),
		...getSessionMetadata(ctx),
		turnIndex: state.turnIndex,
		...event,
	};
	state.events.push(fullEvent);
	try {
		appendFileSync(ensureOutputPath(ctx), `${JSON.stringify(fullEvent)}\n`, "utf8");
	} catch {
		// Never break the agent for telemetry.
	}
}

function summarizeUsage(records: TokenUsageRecord[]): TokenUsageRecord {
	return records.reduce(
		(acc, item) => ({
			input: acc.input + item.input,
			output: acc.output + item.output,
			cacheRead: acc.cacheRead + item.cacheRead,
			cacheWrite: acc.cacheWrite + item.cacheWrite,
			total: acc.total + item.total,
			costUsd: acc.costUsd + item.costUsd,
		}),
		{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0 },
	);
}

function cacheHitRatio(usage: TokenUsageRecord): number {
	const denom = usage.input + usage.cacheRead + usage.cacheWrite;
	return denom > 0 ? usage.cacheRead / denom : 0;
}

function formatNumber(value: number): string {
	return Math.round(value).toLocaleString();
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function buildPromptBreakdown(event: { prompt: string; systemPrompt: string; systemPromptOptions: any }): PromptTokenBreakdown {
	const options = event.systemPromptOptions ?? {};
	const toolSnippetText = Object.entries(options.toolSnippets ?? {})
		.map(([name, snippet]) => `${name}: ${String(snippet)}`)
		.join("\n");
	const contextFilesText = Array.isArray(options.contextFiles)
		? options.contextFiles.map((file: { path?: string; content?: string }) => `${file.path ?? "unknown"}\n${file.content ?? ""}`).join("\n\n")
		: "";
	const skillsText = Array.isArray(options.skills)
		? options.skills.map((skill: { name?: string; description?: string; filePath?: string }) => `${skill.name ?? ""}: ${skill.description ?? ""}\n${skill.filePath ?? ""}`).join("\n")
		: "";
	const promptGuidelinesText = Array.isArray(options.promptGuidelines) ? options.promptGuidelines.join("\n") : "";

	const known =
		estimateTextTokens(String(options.customPrompt ?? "")) +
		estimateTextTokens(String(options.appendSystemPrompt ?? "")) +
		estimateTextTokens(promptGuidelinesText) +
		estimateTextTokens(toolSnippetText) +
		estimateTextTokens(contextFilesText) +
		estimateTextTokens(skillsText);
	const system = estimateTextTokens(event.systemPrompt ?? "");

	return {
		system,
		customPrompt: estimateTextTokens(String(options.customPrompt ?? "")),
		appendSystemPrompt: estimateTextTokens(String(options.appendSystemPrompt ?? "")),
		promptGuidelines: estimateTextTokens(promptGuidelinesText),
		toolSnippets: estimateTextTokens(toolSnippetText),
		contextFiles: estimateTextTokens(contextFilesText),
		skillsRegistry: estimateTextTokens(skillsText),
		latestUser: estimateTextTokens(event.prompt ?? ""),
		unknown: Math.max(0, system - known),
		estimated: true,
	};
}

function commandSummary(): string {
	const usage = summarizeUsage(state.assistantUsage);
	const toolTokens = Array.from(state.toolStats.values()).reduce((sum, item) => sum + item.estimatedTokens, 0);
	const contextTokens = state.latestBreakdown
		? Object.entries(state.latestBreakdown)
				.filter(([key]) => key !== "estimated")
				.reduce((sum, [, value]) => sum + (typeof value === "number" ? value : 0), 0)
		: 0;

	return [
		"Token ledger summary",
		`events=${state.events.length}, turns=${state.turnIndex ?? 0}, jsonl=${state.outputPath ?? "not initialized"}`,
		`assistant usage: input=${formatNumber(usage.input)}, output=${formatNumber(usage.output)}, cacheRead=${formatNumber(usage.cacheRead)}, cacheWrite=${formatNumber(usage.cacheWrite)}, total=${formatNumber(usage.total)}, cost=$${usage.costUsd.toFixed(4)}`,
		`cache hit ratio=${formatPercent(cacheHitRatio(usage))}`,
		`latest prompt estimate=${formatNumber(contextTokens)} tokens, tool result estimate=${formatNumber(toolTokens)} tokens`,
	].join("\n");
}

function commandBreakdown(): string {
	const b = state.latestBreakdown;
	if (!b) return "No prompt breakdown recorded yet.";
	return [
		"Latest prompt breakdown (estimated)",
		`system=${formatNumber(b.system)}`,
		`unknown/base=${formatNumber(b.unknown)}`,
		`customPrompt=${formatNumber(b.customPrompt)}`,
		`appendSystemPrompt=${formatNumber(b.appendSystemPrompt)}`,
		`promptGuidelines=${formatNumber(b.promptGuidelines)}`,
		`toolSnippets=${formatNumber(b.toolSnippets)}`,
		`contextFiles=${formatNumber(b.contextFiles)}`,
		`skillsRegistry=${formatNumber(b.skillsRegistry)}`,
		`latestUser=${formatNumber(b.latestUser)}`,
	].join("\n");
}

function commandCache(): string {
	const usage = summarizeUsage(state.assistantUsage);
	return [
		"Cache usage",
		`cacheRead=${formatNumber(usage.cacheRead)}`,
		`cacheWrite=${formatNumber(usage.cacheWrite)}`,
		`nonCachedInput=${formatNumber(usage.input)}`,
		`hitRatio=${formatPercent(cacheHitRatio(usage))}`,
		`PI_CACHE_RETENTION=${process.env.PI_CACHE_RETENTION ?? "unset"}`,
		`latestPayloadHash=${state.latestPayload?.hash ?? "none"}`,
		`stablePrefixHash=${state.latestStablePrefix?.hash ?? "none"}`,
		`stablePrefix=${(() => {
			const s = summarizePrefixStability(state.stablePrefixHashes);
			return `${s.stable ? "stable" : "changed"} (${s.unique}/${s.total} unique, changes=${s.changes})`;
		})()}`,
	].join("\n");
}

function commandTools(): string {
	if (state.toolStats.size === 0) return "No tool result stats recorded yet.";
	const lines = ["Tool result estimates"];
	for (const [tool, stats] of Array.from(state.toolStats.entries()).sort(([a], [b]) => a.localeCompare(b))) {
		lines.push(
			`- ${tool}: calls=${stats.calls}, errors=${stats.errors}, chars=${formatNumber(stats.chars)}, estTokens=${formatNumber(stats.estimatedTokens)}`,
		);
	}
	return lines.join("\n");
}

function handleTokensCommand(args: string, ctx: ExtensionCommandContext): void {
	const subcommand = args.trim();
	if (subcommand === "breakdown") {
		ctx.ui.notify(commandBreakdown(), "info");
		return;
	}
	if (subcommand === "cache") {
		ctx.ui.notify(commandCache(), "info");
		return;
	}
	if (subcommand === "tools") {
		ctx.ui.notify(commandTools(), "info");
		return;
	}
	if (subcommand === "skills" || subcommand === "skill-audit") {
		ctx.ui.notify(formatSkillAudit(auditSkills(state.latestSkills)), "info");
		return;
	}
	if (subcommand === "context" || subcommand === "context-audit") {
		const audit = state.latestContextAudit ?? buildContextAudit(state.latestContextFiles);
		state.latestContextAudit = audit;
		ctx.ui.notify(formatContextAudit(audit, state.latestContextIndexPath), "info");
		return;
	}
	if (subcommand === "context-write") {
		const audit = state.latestContextAudit ?? buildContextAudit(state.latestContextFiles);
		state.latestContextAudit = audit;
		state.latestContextIndexPath = writeContextIndex(ctx.cwd, audit.index);
		ctx.ui.notify(formatContextAudit(audit, state.latestContextIndexPath), "info");
		return;
	}
	if (subcommand === "masking" || subcommand === "masking-audit") {
		const entries = ctx.sessionManager.getBranch();
		ctx.ui.notify(formatMaskingAudit(auditObservationMasking(entries)), "info");
		return;
	}
	if (subcommand === "export") {
		ctx.ui.notify(state.outputPath ?? ensureOutputPath(ctx), "info");
		return;
	}
	if (subcommand === "reset") {
		state.events.length = 0;
		state.assistantUsage.length = 0;
		state.toolStats.clear();
		state.latestBreakdown = undefined;
		state.latestPayload = undefined;
		state.latestStablePrefix = undefined;
		state.stablePrefixHashes.length = 0;
		state.latestSkills = [];
		state.latestContextFiles = [];
		state.latestContextAudit = undefined;
		state.latestContextIndexPath = undefined;
		state.providerResponses = 0;
		ctx.ui.notify("Token ledger in-memory stats reset. JSONL file left intact.", "info");
		return;
	}
	ctx.ui.notify(commandSummary(), "info");
}

export default function tokenLedgerExtension(pi: ExtensionAPI): void {
	pi.registerCommand("tokens", {
		description: "Show token ledger stats. Args: breakdown, cache, tools, skills, context, masking, export, reset",
		getArgumentCompletions: (prefix) => {
			const options = ["breakdown", "cache", "tools", "skills", "skill-audit", "context", "context-audit", "context-write", "masking", "masking-audit", "export", "reset"];
			return options.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => handleTokensCommand(args, ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		state.events.length = 0;
		state.assistantUsage.length = 0;
		state.toolStats.clear();
		state.turnIndex = undefined;
		state.latestBreakdown = undefined;
		state.latestPayload = undefined;
		state.latestStablePrefix = undefined;
		state.stablePrefixHashes.length = 0;
		state.latestSkills = [];
		state.latestContextFiles = [];
		state.latestContextAudit = undefined;
		state.latestContextIndexPath = undefined;
		state.providerResponses = 0;
		state.outputPath = undefined;
		record(ctx, { kind: "session_start", metadata: { cwd: ctx.cwd, outputPath: ensureOutputPath(ctx) } });
	});

	pi.on("turn_start", async (event, ctx) => {
		state.turnIndex = event.turnIndex;
		record(ctx, { kind: "turn_start", metadata: { eventTimestamp: event.timestamp } });
	});

	pi.on("turn_end", async (event, ctx) => {
		record(ctx, { kind: "turn_end", metadata: { toolResults: event.toolResults.length } });
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const breakdown = buildPromptBreakdown(event);
		const stablePrefix = buildStablePrefixSnapshot(event.systemPromptOptions);
		state.latestSkills = Array.isArray(event.systemPromptOptions.skills) ? event.systemPromptOptions.skills : [];
		state.latestContextFiles = Array.isArray(event.systemPromptOptions.contextFiles) ? event.systemPromptOptions.contextFiles : [];
		state.latestContextAudit = buildContextAudit(state.latestContextFiles);
		state.latestBreakdown = breakdown;
		state.latestStablePrefix = stablePrefix;
		state.stablePrefixHashes.push(stablePrefix.hash);
		const contextUsage = ctx.getContextUsage();
		record(ctx, {
			kind: "prompt_breakdown",
			breakdown,
			metadata: {
				systemPromptHash: sha256(event.systemPrompt),
				stablePrefix,
				prefixStability: summarizePrefixStability(state.stablePrefixHashes),
				systemPromptChars: event.systemPrompt.length,
				selectedTools: event.systemPromptOptions.selectedTools ?? [],
				contextFileCount: event.systemPromptOptions.contextFiles?.length ?? 0,
				skillCount: event.systemPromptOptions.skills?.length ?? 0,
				contextUsage,
			},
		});
	});

	pi.on("before_provider_request", async (event, ctx) => {
		const serialized = safeStringify(event.payload);
		const payloadRecord = {
			hash: sha256(serialized),
			chars: serialized.length,
			estimatedTokens: estimateTextTokens(serialized),
		};
		state.latestPayload = payloadRecord;
		record(ctx, { kind: "provider_payload", metadata: payloadRecord });
		return undefined;
	});

	pi.on("after_provider_response", async (event, ctx) => {
		state.providerResponses += 1;
		record(ctx, {
			kind: "provider_response",
			metadata: {
				status: event.status,
				headers: Object.fromEntries(
					Object.entries(event.headers).filter(([key]) => ["x-request-id", "request-id", "cf-ray", "openai-processing-ms"].includes(key.toLowerCase())),
				),
			},
		});
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		const usage = normalizeUsage(event.message.usage);
		if (!usage) return;
		state.assistantUsage.push(usage);
		record(ctx, {
			kind: "assistant_usage",
			provider: event.message.provider,
			model: event.message.model,
			usage,
			metadata: {
				api: event.message.api,
				stopReason: event.message.stopReason,
				responseModel: event.message.responseModel,
			},
		});
	});

	pi.on("tool_result", async (event, ctx) => {
		const compaction = compactToolOutput({ toolName: event.toolName, input: event.input, content: event.content });
		const effectiveContent = compaction.changed && compaction.content ? compaction.content : event.content;
		const text = effectiveContent.map((block) => {
			if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block) {
				return String(block.text);
			}
			return "[image]";
		}).join("\n");
		const chars = text.length;
		const estimatedTokens = estimateTextTokens(text);
		const current = state.toolStats.get(event.toolName) ?? { calls: 0, chars: 0, estimatedTokens: 0, errors: 0 };
		current.calls += 1;
		current.chars += chars;
		current.estimatedTokens += estimatedTokens;
		if (event.isError) current.errors += 1;
		state.toolStats.set(event.toolName, current);
		record(ctx, {
			kind: "tool_result",
			metadata: {
				toolName: event.toolName,
				toolCallId: event.toolCallId,
				isError: event.isError,
				chars,
				estimatedTokens,
				lines: countLines(text),
				contentBlocks: effectiveContent.length,
				compaction: compaction.metadata,
			},
		});
		if (!compaction.changed) return undefined;
		const details = event.details && typeof event.details === "object"
			? { ...event.details as Record<string, unknown>, metadata: { ...((event.details as Record<string, unknown>).metadata as Record<string, unknown> | undefined), piTokenCompaction: compaction.metadata } }
			: { metadata: { piTokenCompaction: compaction.metadata }, rawDetails: event.details };
		return { content: compaction.content as typeof event.content, details };
	});
}
