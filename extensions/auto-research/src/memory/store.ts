import fs from "node:fs/promises";
import path from "node:path";
import type { Evidence, ResearchChunk, ResearchRun } from "../engine/schemas";
import { canonicalEvidenceKey, hash } from "./canonical";

export interface MemoryHit extends Evidence { score: number; provider: "memory"; }

export class ResearchMemory {
	constructor(private root: string) {}
	private evidenceDir() { return path.join(this.root, "evidence"); }
	private chunksFile() { return path.join(this.root, "chunks", "chunks.jsonl"); }

	async init() {
		await fs.mkdir(this.evidenceDir(), { recursive: true });
		await fs.mkdir(path.dirname(this.chunksFile()), { recursive: true });
	}

	async upsertRun(run: ResearchRun) {
		await this.init();
		await fs.mkdir(path.join(this.root, "runs-index"), { recursive: true });
		await fs.writeFile(path.join(this.root, "runs-index", `${run.id}.json`), JSON.stringify(run, null, 2) + "\n", "utf8");
	}

	async upsertEvidence(items: Evidence[]) {
		await this.init();
		const chunkLines: string[] = [];
		for (const item of items) {
			const canonicalKey = canonicalEvidenceKey(item);
			const id = item.id || hash(`${canonicalKey}:${item.retrievalQuery}`);
			const e = { ...item, id, canonicalKey };
			await fs.writeFile(path.join(this.evidenceDir(), `${id}.json`), JSON.stringify(e, null, 2) + "\n", "utf8");
			const text = `${e.title}\n${e.snippet}`.trim();
			const chunk: ResearchChunk = { id: hash(`${id}:snippet`), sourceKind: "evidence", sourceId: id, title: e.title, url: e.url, text, tags: e.tags, createdAt: new Date().toISOString() };
			chunkLines.push(JSON.stringify(chunk));
		}
		if (chunkLines.length) await fs.appendFile(this.chunksFile(), chunkLines.join("\n") + "\n", "utf8");
	}

	async search(query: string, limit = 8): Promise<MemoryHit[]> {
		await this.init();
		const terms = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
		const files = await fs.readdir(this.evidenceDir()).catch(() => []);
		const hits: MemoryHit[] = [];
		for (const f of files.filter(f => f.endsWith(".json"))) {
			try {
				const e = JSON.parse(await fs.readFile(path.join(this.evidenceDir(), f), "utf8")) as Evidence;
				const hay = `${e.title} ${e.snippet} ${e.tags.join(" ")} ${e.retrievalQuery}`.toLowerCase();
				const matched = terms.filter(t => hay.includes(t)).length;
				if (!matched) continue;
				const score = matched / Math.max(terms.length, 1) + (e.confidence === "high" ? 0.25 : e.confidence === "medium" ? 0.1 : 0);
				hits.push({ ...e, provider: "memory", score, tags: Array.from(new Set([...(e.tags || []), "memory"])) });
			} catch {}
		}
		return hits.sort((a, b) => b.score - a.score).slice(0, limit);
	}
}

export function memoryHasEnough(hits: MemoryHit[]) {
	const relevant = hits.filter(h => h.score >= 0.45);
	return relevant.length >= 5 && relevant.some(h => h.confidence === "high");
}
