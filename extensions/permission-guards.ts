import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const REMOVE_PATTERNS: RegExp[] = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bunlink\b/i,
	/\btrash\b/i,
	/\btrash-put\b/i,
	/\bremove\b/i,
	/\bfind\b[\s\S]*(?:\s-delete\b|\s-exec\s+(?:rm|rmdir|unlink)\b)/i,
];

const GIT_FORCE_PATTERN = /\bgit\b[\s\S]*(?:--force(?:-with-lease|-if-includes)?\b|-f\b)/i;

type GuardMatch = {
	reason: string;
	pattern: RegExp;
};

function matchedGuard(command: string): GuardMatch | undefined {
	const removePattern = REMOVE_PATTERNS.find((pattern) => pattern.test(command));
	if (removePattern) {
		return { reason: "remove command", pattern: removePattern };
	}

	if (GIT_FORCE_PATTERN.test(command)) {
		return { reason: "git force command", pattern: GIT_FORCE_PATTERN };
	}

	return undefined;
}

export default function permissionGuards(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = String((event.input as { command?: unknown }).command ?? "");
		const guard = matchedGuard(command);
		if (!guard) return undefined;

		if (!ctx.hasUI) {
			return { block: true, reason: `Blocked ${guard.reason}: no UI for confirmation` };
		}

		const choice = await ctx.ui.select(
			`Permission required: ${guard.reason}\n\n${command}\n\nRun this command?`,
			["Yes", "No", "Q&A"],
		);

		if (choice === "Yes") return undefined;

		if (choice === "Q&A") {
			const question = await ctx.ui.input(
				"Ask about this command before deciding:",
				"e.g. Why is this safe? What files are affected?",
			);
			const prompt = question?.trim()
				? `Before running this guarded ${guard.reason}, answer this question: ${question.trim()}\n\nCommand:\n${command}\n\nDo not run it until I explicitly approve.`
				: `Explain why this guarded ${guard.reason} is needed and what it affects. Do not run it until I explicitly approve.\n\nCommand:\n${command}`;
			pi.sendUserMessage(prompt, { deliverAs: "steer" });
			return { block: true, reason: "Blocked pending Q&A" };
		}

		return { block: true, reason: `Blocked ${guard.reason} by user` };
	});
}
