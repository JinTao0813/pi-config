import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config";
import { runResearch } from "./engine/runner";
import { ResearchMemory } from "./memory/store";
import type { Depth, ResearchMode } from "./engine/schemas";

export function registerCommands(pi: ExtensionAPI) {
	pi.registerCommand("research", {
		description: "Run deep topic research: /research <topic> [--quick|--deep]",
		handler: async (args, ctx) => runCommand("deep_topic", args, ctx),
	});
	pi.registerCommand("discover", {
		description: "Run opportunity discovery: /discover <idea> [--quick|--deep]",
		handler: async (args, ctx) => runCommand("opportunity_discovery", args, ctx),
	});
	pi.registerCommand("research-list", {
		description: "List auto-research runs",
		handler: async (_args, ctx) => {
			const root = loadConfig().artifactRoot;
			const rows = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
			const runs = rows.filter(r => r.isDirectory()).map(r => r.name).sort().reverse().slice(0, 20);
			ctx.ui.notify(runs.length ? runs.join("\n") : "No research runs found", "info");
		},
	});
	pi.registerCommand("research-index", {
		description: "Index existing research artifacts into global memory",
		handler: async (_args, ctx) => {
			const root = loadConfig().artifactRoot;
			const memory = new ResearchMemory(root);
			const rows = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
			let count = 0;
			for (const r of rows.filter(r => r.isDirectory())) {
				const file = path.join(root, r.name, "evidence.jsonl");
				const text = await fs.readFile(file, "utf8").catch(() => "");
				const items = text.split(/\n+/).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
				if (items.length) { await memory.upsertEvidence(items); count += items.length; }
			}
			ctx.ui.notify(`Indexed ${count} evidence items into research memory`, "success");
		},
	});
	pi.registerCommand("research-open", {
		description: "Show path to a run report: /research-open <run-id>",
		handler: async (args, ctx) => {
			const id = args.trim();
			if (!id) return ctx.ui.notify("Usage: /research-open <run-id>", "warning");
			const report = path.join(loadConfig().artifactRoot, id, "report.md");
			ctx.ui.notify(report, "info");
		},
	});
}

async function runCommand(mode: ResearchMode, args: string, ctx: any) {
	const { query, depth, forceRefresh } = parseArgs(args);
	if (!query) {
		ctx.ui.notify(mode === "deep_topic" ? "Usage: /research <topic> [--quick|--deep]" : "Usage: /discover <idea> [--quick|--deep]", "warning");
		return;
	}
	ctx.ui.setStatus("auto-research", "Starting");
	try {
		const result = await runResearch(mode, query, depth, undefined, msg => ctx.ui.setStatus("auto-research", msg), { forceRefresh });
		ctx.ui.setStatus("auto-research", "Done");
		ctx.ui.notify(`Research complete: ${result.reportPath}`, "success");
	} catch (err) {
		ctx.ui.setStatus("auto-research", "Failed");
		ctx.ui.notify(`Research failed: ${String((err as Error).message || err)}`, "error");
	}
}

function parseArgs(args: string): { query: string; depth: Depth; forceRefresh: boolean } {
	let depth: Depth = "standard";
	let forceRefresh = /--refresh\b/.test(args);
	let query = args.replace(/--(quick|deep|standard|refresh)\b/g, (_m, d) => { if (d !== "refresh") depth = d; return ""; }).trim();
	return { query, depth, forceRefresh };
}
