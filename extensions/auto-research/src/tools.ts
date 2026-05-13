import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runResearch } from "./engine/runner";

const Depth = Type.Optional(Type.Union([Type.Literal("quick"), Type.Literal("standard"), Type.Literal("deep")]));
const ForceRefresh = Type.Optional(Type.Boolean());

export function registerTools(pi: ExtensionAPI) {
	pi.registerTool({
		name: "research_topic",
		label: "Research Topic",
		description: "Run evidence-driven topic research and write artifacts under global pi research storage.",
		parameters: Type.Object({ topic: Type.String(), depth: Depth, forceRefresh: ForceRefresh }),
		async execute(_id, params, signal, onUpdate, _ctx) {
			const result = await runResearch("deep_topic", params.topic, params.depth || "standard", signal, msg => onUpdate?.({ content: [{ type: "text", text: msg }], details: {} }), { forceRefresh: params.forceRefresh });
			return toolResult(result);
		},
	});

	pi.registerTool({
		name: "discover_opportunity",
		label: "Discover Opportunity",
		description: "Run opportunity/market discovery and write artifacts under global pi research storage.",
		parameters: Type.Object({ idea: Type.String(), depth: Depth, forceRefresh: ForceRefresh }),
		async execute(_id, params, signal, onUpdate, _ctx) {
			const result = await runResearch("opportunity_discovery", params.idea, params.depth || "standard", signal, msg => onUpdate?.({ content: [{ type: "text", text: msg }], details: {} }), { forceRefresh: params.forceRefresh });
			return toolResult(result);
		},
	});
}

function toolResult(result: Awaited<ReturnType<typeof runResearch>>) {
	return {
		content: [{ type: "text" as const, text: `Research complete.\nRun: ${result.run.id}\nReport: ${result.reportPath}\nSummary: ${result.summaryPath}\nEvidence: ${result.evidence.length} items\n\nTop sources:\n${result.evidence.slice(0, 5).map((e, i) => `${i + 1}. ${e.title} (${e.confidence}) ${e.url || ""}`).join("\n")}` }],
		details: { run: result.run, reportPath: result.reportPath, summaryPath: result.summaryPath, evidenceCount: result.evidence.length },
	};
}
