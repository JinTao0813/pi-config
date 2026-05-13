import crypto from "node:crypto";
import type { Evidence } from "../engine/schemas";

export function normalizeTitle(s: string) {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function canonicalEvidenceKey(e: Pick<Evidence, "canonicalKey" | "url" | "title" | "publishedAt">) {
	if (e.canonicalKey) return e.canonicalKey;
	const url = e.url || "";
	const doi = url.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0];
	if (doi) return `doi:${doi.toLowerCase()}`;
	const arxiv = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i)?.[1];
	if (arxiv) return `arxiv:${arxiv.replace(/v\d+$/, "")}`;
	if (url) return `url:${canonicalUrl(url)}`;
	return `title:${hash(`${normalizeTitle(e.title)}:${(e.publishedAt || "").slice(0, 4)}`)}`;
}

export function canonicalUrl(raw: string) {
	try {
		const u = new URL(raw);
		u.hash = "";
		for (const p of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"]) u.searchParams.delete(p);
		return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
	} catch { return raw.toLowerCase(); }
}

export function hash(s: string) { return crypto.createHash("sha1").update(s).digest("hex").slice(0, 16); }
