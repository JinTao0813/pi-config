import crypto from "node:crypto";
import { getEnv } from "../../../shared/env";
import type { AutoResearchConfig } from "../config";
import { gradeEvidence } from "../engine/grader";
import type { Evidence, SearchTask } from "../engine/schemas";

export async function searchPapers(task: SearchTask, config: AutoResearchConfig, signal?: AbortSignal): Promise<Evidence[]> {
	const providers = (getEnv("PI_AUTO_RESEARCH_PAPER_PROVIDERS") || "openalex,semanticscholar,arxiv,crossref").split(",").map(s => s.trim()).filter(Boolean);
	const batches = await Promise.all(providers.map(async p => {
		try {
			if (p === "openalex") return await searchOpenAlex(task, signal);
			if (p === "semanticscholar") return await searchSemanticScholar(task, signal);
			if (p === "arxiv") return await searchArxiv(task, signal);
			if (p === "crossref") return await searchCrossref(task, signal);
			return [];
		} catch { return []; }
	}));
	return batches.flat().slice(0, Math.max(3, config.maxSources));
}

async function searchOpenAlex(task: SearchTask, signal?: AbortSignal): Promise<Evidence[]> {
	const mail = getEnv("PI_RESEARCH_CONTACT_EMAIL");
	const url = `https://api.openalex.org/works?search=${encodeURIComponent(task.query)}&per-page=5${mail ? `&mailto=${encodeURIComponent(mail)}` : ""}`;
	const json = await fetchJson(url, signal);
	return (json.results || []).map((w: any) => paperEvidence(task, {
		title: w.title,
		url: w.open_access?.oa_url || w.primary_location?.landing_page_url || w.id,
		snippet: abstractFromInvertedIndex(w.abstract_inverted_index) || w.title || "",
		provider: "openalex",
		canonicalKey: w.doi ? `doi:${String(w.doi).replace(/^https?:\/\/doi.org\//, "").toLowerCase()}` : `openalex:${w.id}`,
		publishedAt: w.publication_year ? String(w.publication_year) : undefined,
		citationCount: w.cited_by_count,
	}));
}

async function searchSemanticScholar(task: SearchTask, signal?: AbortSignal): Promise<Evidence[]> {
	const fields = "title,abstract,year,authors,url,venue,citationCount,externalIds,openAccessPdf,tldr";
	const headers: Record<string, string> = {};
	const semanticScholarKey = getEnv("SEMANTIC_SCHOLAR_API_KEY");
	if (semanticScholarKey) headers["x-api-key"] = semanticScholarKey;
	const json = await fetchJson(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(task.query)}&limit=5&fields=${fields}`, signal, headers);
	return (json.data || []).map((p: any) => paperEvidence(task, {
		title: p.title,
		url: p.openAccessPdf?.url || p.url,
		snippet: p.tldr?.text || p.abstract || p.title || "",
		provider: "semantic_scholar",
		canonicalKey: p.externalIds?.DOI ? `doi:${String(p.externalIds.DOI).toLowerCase()}` : p.externalIds?.ArXiv ? `arxiv:${p.externalIds.ArXiv}` : `s2:${p.paperId}`,
		publishedAt: p.year ? String(p.year) : undefined,
		citationCount: p.citationCount,
	}));
}

async function searchArxiv(task: SearchTask, signal?: AbortSignal): Promise<Evidence[]> {
	const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(task.query)}&start=0&max_results=5&sortBy=relevance&sortOrder=descending`;
	const xml = await (await fetch(url, { signal, headers: { "user-agent": "pi-auto-research/0.1" } })).text();
	return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
		const entry = m[1];
		const idUrl = tag(entry, "id");
		const arxivId = idUrl.match(/abs\/([^/]+)$/)?.[1];
		return paperEvidence(task, { title: clean(tag(entry, "title")), url: idUrl, snippet: clean(tag(entry, "summary")), provider: "arxiv", canonicalKey: arxivId ? `arxiv:${arxivId.replace(/v\d+$/, "")}` : undefined, publishedAt: tag(entry, "published") });
	});
}

async function searchCrossref(task: SearchTask, signal?: AbortSignal): Promise<Evidence[]> {
	const mail = getEnv("PI_RESEARCH_CONTACT_EMAIL");
	const url = `https://api.crossref.org/works?query=${encodeURIComponent(task.query)}&rows=5${mail ? `&mailto=${encodeURIComponent(mail)}` : ""}`;
	const json = await fetchJson(url, signal);
	return (json.message?.items || []).map((w: any) => paperEvidence(task, {
		title: Array.isArray(w.title) ? w.title[0] : w.title,
		url: w.URL || (w.DOI ? `https://doi.org/${w.DOI}` : undefined),
		snippet: Array.isArray(w.subject) ? w.subject.join(", ") : "",
		provider: "crossref",
		canonicalKey: w.DOI ? `doi:${String(w.DOI).toLowerCase()}` : undefined,
		publishedAt: w.published?.["date-parts"]?.[0]?.[0] ? String(w.published["date-parts"][0][0]) : undefined,
		citationCount: w["is-referenced-by-count"],
	}));
}

function paperEvidence(task: SearchTask, p: any): Evidence {
	return gradeEvidence({
		id: crypto.createHash("sha1").update(`${p.provider}:${p.canonicalKey || p.url || p.title}:${task.id}`).digest("hex").slice(0, 10),
		title: clean(p.title || "Untitled paper"), url: p.url, sourceType: p.provider === "arxiv" ? "preprint" : "paper", snippet: clean(p.snippet || "").slice(0, 1200), retrievalQuery: task.query, fetchedAt: new Date().toISOString(), canonicalKey: p.canonicalKey, provider: p.provider, publishedAt: p.publishedAt, citationCount: p.citationCount,
	});
}

async function fetchJson(url: string, signal?: AbortSignal, headers: Record<string, string> = {}) { const res = await fetch(url, { signal, headers: { "user-agent": "pi-auto-research/0.1", ...headers } }); if (!res.ok) throw new Error(`${url} ${res.status}`); return res.json() as any; }
function tag(xml: string, name: string) { return xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`))?.[1] || ""; }
function clean(s: string) { return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim(); }
function abstractFromInvertedIndex(inv: any) { if (!inv) return ""; const words: string[] = []; for (const [w, pos] of Object.entries(inv)) for (const i of pos as number[]) words[i] = w; return words.filter(Boolean).join(" "); }
