import fs from "node:fs/promises";
import path from "node:path";
import type { Evidence, ResearchPlan, ResearchRun } from "../engine/schemas";

export function slugify(s: string) {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "research";
}

export async function createRun(root: string, mode: ResearchRun["mode"], query: string, depth: ResearchRun["depth"]): Promise<ResearchRun> {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const id = `${stamp}-${slugify(query)}`;
	const artifactDir = path.join(root, id);
	await fs.mkdir(artifactDir, { recursive: true });
	const run: ResearchRun = { id, mode, query, depth, startedAt: new Date().toISOString(), status: "planning", artifactDir };
	await writeJson(path.join(artifactDir, "run.json"), run);
	return run;
}

export async function updateRun(run: ResearchRun, status: ResearchRun["status"]) {
	run.status = status;
	await writeJson(path.join(run.artifactDir, "run.json"), run);
}

export async function writeJson(file: string, data: unknown) {
	await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function writePlan(run: ResearchRun, plan: ResearchPlan) { await writeJson(path.join(run.artifactDir, "plan.json"), plan); }
export async function writeEvidence(run: ResearchRun, evidence: Evidence[]) {
	await fs.writeFile(path.join(run.artifactDir, "evidence.jsonl"), evidence.map(e => JSON.stringify(e)).join("\n") + "\n", "utf8");
}
export async function writeRejectedEvidence(run: ResearchRun, rejected: unknown[]) {
	await fs.writeFile(path.join(run.artifactDir, "rejected.jsonl"), rejected.map(e => JSON.stringify(e)).join("\n") + (rejected.length ? "\n" : ""), "utf8");
}
