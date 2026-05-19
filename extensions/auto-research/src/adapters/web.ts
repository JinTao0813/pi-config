import crypto from "node:crypto";
import { getEnv } from "../../../lib/env";
import type { AutoResearchConfig } from "../config";
import { gradeEvidence } from "../engine/grader";
import type { Evidence, SearchTask } from "../engine/schemas";

export async function searchWeb(task: SearchTask, config: AutoResearchConfig, signal?: AbortSignal): Promise<Evidence[]> {
	if (config.webProvider === "none") return [];
	if (config.webProvider === "tavily" && getEnv(config.tavilyApiKeyEnv)) return searchTavily(task, config, signal);
	return searchDuckDuckGo(task, signal);
}

async function searchTavily(task: SearchTask, config: AutoResearchConfig, signal?: AbortSignal): Promise<Evidence[]> {
	const res = await fetch("https://api.tavily.com/search", {
		method: "POST",
		signal,
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ api_key: getEnv(config.tavilyApiKeyEnv), query: task.query, max_results: 5, search_depth: "basic" }),
	});
	if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
	const json = await res.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
	return (json.results || []).map((r) => normalize(task, r.title || r.url || "Untitled", r.url, r.content || "", "web"));
}

async function searchDuckDuckGo(task: SearchTask, signal?: AbortSignal): Promise<Evidence[]> {
	const rows = await searchDuckDuckGoHtml(task, signal).catch(() => []);
	if (rows.length) return rows.slice(0, 5).map(r => normalize(task, r.title, r.url, r.snippet, "web"));

	const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(task.query)}&format=json&no_html=1&skip_disambig=1`;
	const res = await fetch(url, { signal, headers: { "user-agent": "pi-auto-research/0.1" } });
	if (!res.ok) throw new Error(`DuckDuckGo search failed: ${res.status}`);
	const json = await res.json() as any;
	if (json.AbstractText) rows.push({ title: json.Heading || task.query, url: json.AbstractURL, snippet: json.AbstractText });
	for (const t of json.RelatedTopics || []) {
		if (t.Text) rows.push({ title: t.Text.split(" - ")[0], url: t.FirstURL, snippet: t.Text });
		for (const x of t.Topics || []) if (x.Text) rows.push({ title: x.Text.split(" - ")[0], url: x.FirstURL, snippet: x.Text });
	}
	return rows.slice(0, 5).map(r => normalize(task, r.title, r.url, r.snippet, "web"));
}

async function searchDuckDuckGoHtml(task: SearchTask, signal?: AbortSignal): Promise<Array<{ title: string; url?: string; snippet: string }>> {
	const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(task.query)}`, { signal, headers: { "user-agent": "pi-auto-research/0.1" } });
	if (!res.ok) throw new Error(`DuckDuckGo HTML search failed: ${res.status}`);
	const html = await res.text();
	return [...html.matchAll(/<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({ title: decodeHtml(m[2].replace(/<[^>]+>/g, " ")), url: decodeDuckUrl(m[1]), snippet: decodeHtml(m[3].replace(/<[^>]+>/g, " ")) }));
}

function decodeDuckUrl(u: string) { try { const x = new URL(u, "https://duckduckgo.com"); return x.searchParams.get("uddg") || u; } catch { return u; } }
function decodeHtml(s: string) { return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim(); }

function normalize(task: SearchTask, title: string, url: string | undefined, snippet: string, sourceType: Evidence["sourceType"]): Evidence {
	return gradeEvidence({
		id: crypto.createHash("sha1").update(`${url || title}:${task.id}`).digest("hex").slice(0, 10),
		title,
		url,
		sourceType,
		snippet: snippet.slice(0, 1200),
		retrievalQuery: task.query,
		fetchedAt: new Date().toISOString(),
	});
}
