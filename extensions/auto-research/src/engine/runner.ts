import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config";
import { searchWeb } from "../adapters/web";
import { searchPapers } from "../adapters/papers";
import { createPlan } from "./planner";
import { inferIntent, expandQuery } from "./intent";
import { judgeEvidence } from "./rerank";
import type { Depth, ResearchMode, ResearchResult } from "./schemas";
import { createRun, updateRun, writeEvidence, writeJson, writePlan, writeRejectedEvidence } from "../output/artifact-writer";
import { ResearchMemory, memoryHasEnough } from "../memory/store";
import { renderReport, renderSummary } from "../output/markdown";

export async function runResearch(mode: ResearchMode, query: string, depth: Depth = "standard", signal?: AbortSignal, onProgress?: (msg: string) => void, options: { forceRefresh?: boolean } = {}): Promise<ResearchResult> {
	const config = loadConfig();
	const memory = new ResearchMemory(config.artifactRoot);
	const run = await createRun(config.artifactRoot, mode, query, depth);
	try {
		onProgress?.("Planning");
		const intent = inferIntent(query);
		const plan = createPlan(mode, query, depth);
		plan.tasks = plan.tasks.map(t => ({ ...t, query: expandQuery(t.query, intent, t.id) }));
		await writePlan(run, plan);
		await memory.upsertRun(run);
		await updateRun(run, "searching");

		const evidence = [];
		for (const task of plan.tasks) {
			onProgress?.(`Searching memory: ${task.id}`);
			const remembered = await memory.search(task.query, config.maxSources);
			let found = remembered;
			if (options.forceRefresh || !memoryHasEnough(remembered)) {
				onProgress?.(`Searching sources: ${task.id}`);
				const papers = await searchPapers(task, config, signal).catch(() => []);
				const web = await searchWeb(task, config, signal).catch(err => [{
					id: `error-${task.id}`,
					title: `Search failed: ${task.id}`,
					sourceType: "web" as const,
					snippet: String(err?.message || err),
					retrievalQuery: task.query,
					fetchedAt: new Date().toISOString(),
					confidence: "low" as const,
					tags: ["error"],
				}]);
				found = [...remembered, ...papers, ...web];
			}
			evidence.push(...found);
			if (evidence.length >= config.maxSources) break;
		}
		const judged = judgeEvidence(query, intent, dedupe(evidence));
		const unique = judged.accepted.slice(0, config.maxSources);
		await writeEvidence(run, unique);
		await writeRejectedEvidence(run, judged.rejected);
		await memory.upsertEvidence(unique);

		await updateRun(run, "synthesizing");
		const reportPath = path.join(run.artifactDir, "report.md");
		const summaryPath = path.join(run.artifactDir, "summary.json");
		await fs.writeFile(reportPath, renderReport(run, plan, unique), "utf8");
		await writeJson(summaryPath, renderSummary(run, unique));
		await updateRun(run, "done");
		return { run, plan, evidence: unique, reportPath, summaryPath };
	} catch (err) {
		await updateRun(run, "failed");
		throw err;
	}
}

function dedupe<T extends { url?: string; title: string; snippet: string }>(items: T[]): T[] {
	const seen = new Set<string>();
	return items.filter(item => {
		const key = item.url || `${item.title}:${item.snippet.slice(0, 80)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
