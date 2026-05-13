import type { Evidence } from "./schemas";
import type { IntentFrame } from "./intent";

export interface RejectedEvidence extends Evidence { rejectReason: string; relevanceScore: number; }
export interface AcceptedEvidence extends Evidence { relevanceScore?: number; }

export function judgeEvidence(query: string, intent: IntentFrame, candidates: Evidence[]): { accepted: AcceptedEvidence[]; rejected: RejectedEvidence[] } {
	const accepted: AcceptedEvidence[] = [];
	const rejected: RejectedEvidence[] = [];
	for (const e of candidates) {
		const j = scoreEvidence(query, intent, e);
		if (j.score >= 0.34 && !j.rejectReason) accepted.push({ ...e, relevanceScore: j.score, tags: Array.from(new Set([...(e.tags || []), "relevance-accepted"])) });
		else rejected.push({ ...e, relevanceScore: j.score, rejectReason: j.rejectReason || "low lexical relevance to intent", tags: Array.from(new Set([...(e.tags || []), "relevance-rejected"])) });
	}
	return { accepted: accepted.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0)), rejected };
}

function scoreEvidence(query: string, intent: IntentFrame, e: Evidence): { score: number; rejectReason?: string } {
	const hay = `${e.title} ${e.snippet} ${e.url || ""} ${e.tags.join(" ")}`.toLowerCase();
	const include = intent.includeTerms.map(t => t.toLowerCase()).filter(t => t.length > 2);
	const matched = include.filter(t => hay.includes(t.toLowerCase())).length;
	let score = matched / Math.max(include.length, 1);
	const entityTokens = intent.entity.toLowerCase().split(/\W+/).filter(Boolean);
	const entityHits = entityTokens.filter(t => hay.includes(t)).length;
	const hasAcronym = entityTokens.some(t => t.length >= 3 && t === t.toUpperCase().toLowerCase());
	if (entityHits === entityTokens.length && entityTokens.length) score += 0.35;
	else if (entityHits > 0) score += 0.15;
	if (e.confidence === "high") score += 0.15;
	if (e.sourceType === "paper" || e.sourceType === "preprint") score += 0.08;
	if (e.citationCount && e.citationCount > 50) score += 0.05;
	const off = intent.excludeTerms.find(t => hay.includes(t.toLowerCase()));
	if (off && entityHits < Math.max(1, entityTokens.length - 1)) return { score: Math.max(0, score - 0.5), rejectReason: `off-topic domain signal: ${off}` };
	if (intent.domainHints.length && !intent.domainHints.some(t => hay.includes(t.toLowerCase())) && entityHits < entityTokens.length) return { score, rejectReason: "missing expected AI/agent domain signals" };
	if (score < 0.34) return { score, rejectReason: "low relevance to query intent" };
	return { score };
}
