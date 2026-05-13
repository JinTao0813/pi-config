import type { Evidence } from "./schemas";

export function gradeEvidence(e: Omit<Evidence, "confidence" | "tags">): Evidence {
	const url = (e.url || "").toLowerCase();
	const tags: string[] = [];
	let score = 1;
	if (/docs\.|developer\.|github\.com|\.gov|\.edu/.test(url)) { score += 2; tags.push("primary-ish"); }
	if (/official|documentation|release notes/i.test(e.title)) { score += 1; tags.push("docs"); }
	if (/medium\.com|substack|blog/.test(url)) { tags.push("commentary"); }
	if (/coupon|casino|best-\d|sponsored/.test(url)) { score -= 2; tags.push("low-quality-signals"); }
	const confidence: Evidence["confidence"] = score >= 3 ? "high" : score <= 0 ? "low" : "medium";
	return { ...e, confidence, tags };
}
