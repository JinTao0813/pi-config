import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type Snapshot = {
	id: string;
	timestamp: number;
	prompt: string;
	userEntryId?: string;
	leafEntryId?: string;
	basePatch: string;
	untrackedPatch: string;
	files: string[];
	undone?: boolean;
};

const TYPE = "undo-redo-snapshot";

export default function (pi: ExtensionAPI) {
	let beforePatch = "";
	let beforeUntracked = "";
	let prompt = "";
	let userEntryId: string | undefined;
	let snapshots: Snapshot[] = [];
	const redoStack: Snapshot[] = [];
	const redoTurns: Array<{ userEntryId: string; restoreEntryId: string; snapshotId?: string }> = [];

	async function git(args: string[]) {
		return pi.exec("git", args, { timeout: 30_000 });
	}

	async function inGitRepo() {
		try {
			const r = await git(["rev-parse", "--is-inside-work-tree"]);
			return r.exitCode === 0 && r.stdout.trim() === "true";
		} catch {
			return false;
		}
	}

	async function diffTracked() {
		const r = await git(["diff", "--binary", "--", "."]);
		return r.stdout;
	}

	async function diffUntracked() {
		const listed = await git(["ls-files", "--others", "--exclude-standard", "-z"]);
		const files = listed.stdout.split("\0").filter(Boolean);
		let patch = "";
		for (const f of files) {
			const r = await pi.exec("git", ["diff", "--no-index", "--binary", "--", "/dev/null", f], { timeout: 30_000 });
			patch += r.stdout.replaceAll("a/dev/null", "a/" + f).replaceAll("b/" + f, "b/" + f) + "\n";
		}
		return patch;
	}

	function filesFromPatch(patch: string) {
		const files = new Set<string>();
		for (const line of patch.split("\n")) {
			const m = /^diff --git a\/(.*?) b\/(.*)$/.exec(line);
			if (m) files.add(m[2]);
		}
		return [...files];
	}

	async function currentPatch() {
		return { basePatch: await diffTracked(), untrackedPatch: await diffUntracked() };
	}

	function stripBefore(after: string, before: string) {
		// If repo was clean-ish at turn start, use exact after patch. If not, store full after patch;
		// undo will still reverse all post-turn visible changes. Safer full snapshots require core support.
		return before.trim() ? after : after;
	}

	async function applyPatch(patch: string, reverse = false) {
		if (!patch.trim()) return;
		const args = ["apply", "--whitespace=nowarn"];
		if (reverse) args.push("--reverse");
		const child = await pi.exec("bash", ["-lc", `git ${args.map(a => JSON.stringify(a)).join(" ")} <<'PATCH'\n${patch}\nPATCH`], { timeout: 30_000 });
		if (child.exitCode !== 0) throw new Error(child.stderr || child.stdout || "git apply failed");
	}

	function label(s: Snapshot) {
		const mark = s.undone ? "↩ " : "";
		const text = s.prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "agent turn";
		return `${mark}${new Date(s.timestamp).toLocaleTimeString()} ${s.id.slice(0, 8)} · ${s.files.length} file(s) · ${text}`;
	}

	pi.on("session_start", async (_event, ctx) => {
		const byId = new Map<string, Snapshot>();
		for (const e of ctx.sessionManager.getEntries()) {
			if (e.type === "custom" && e.customType === TYPE && e.data) {
				const snap = e.data as Snapshot;
				byId.set(snap.id, snap); // latest undo/redo state wins
			}
		}
		snapshots = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
		if (snapshots.length) ctx.ui.setStatus("undo-redo", `undo: ${snapshots.filter(s => !s.undone).length}`);
	});

	pi.on("agent_start", async (event, ctx) => {
		if (!(await inGitRepo())) return;
		prompt = event.prompt;
		userEntryId = ctx.sessionManager.getLeafId();
		const before = await currentPatch();
		beforePatch = before.basePatch;
		beforeUntracked = before.untrackedPatch;
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!(await inGitRepo())) return;
		const after = await currentPatch();
		const basePatch = stripBefore(after.basePatch, beforePatch);
		const untrackedPatch = stripBefore(after.untrackedPatch, beforeUntracked);
		if (!basePatch.trim() && !untrackedPatch.trim()) return;
		const snap: Snapshot = {
			id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
			timestamp: Date.now(),
			prompt,
			userEntryId,
			leafEntryId: ctx.sessionManager.getLeafId(),
			basePatch,
			untrackedPatch,
			files: filesFromPatch(basePatch + "\n" + untrackedPatch),
		};
		snapshots.push(snap);
		redoStack.length = 0;
		pi.appendEntry(TYPE, snap);
		ctx.ui.setStatus("undo-redo", `undo: ${snapshots.filter(s => !s.undone).length}`);
	});

	pi.registerCommand("undo", {
		description: "Undo the latest user message in the current session, removing it and its response from active context",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			const branch = ctx.sessionManager.getBranch() as Array<{ id: string; parentId: string | null; type: string; message?: { role?: string } }>;
			const latestUser = branch.findLast((entry) => entry.type === "message" && entry.message?.role === "user");
			if (!latestUser) return ctx.ui.notify("No user message to undo", "info");

			const currentLeaf = ctx.sessionManager.getLeafId();
			if (!currentLeaf) return ctx.ui.notify("No active session leaf to undo", "info");

			const snap = snapshots.findLast((s) => !s.undone && s.userEntryId === latestUser.id);
			if (snap) {
				await applyPatch(snap.untrackedPatch, true);
				await applyPatch(snap.basePatch, true);
				snap.undone = true;
				redoStack.push(snap);
				pi.appendEntry(TYPE, snap);
			}

			redoTurns.push({ userEntryId: latestUser.id, restoreEntryId: currentLeaf, snapshotId: snap?.id });
			if (latestUser.parentId) await ctx.navigateTree(latestUser.parentId, { summarize: false });
			else ctx.sessionManager.resetLeaf();

			ctx.ui.setStatus("undo-redo", `undo: ${snapshots.filter(s => !s.undone).length}`);
			ctx.ui.notify(`Undone latest message + response${snap ? ` and ${snap.files.length} file(s)` : ""}`, "success");
		}
	});

	pi.registerCommand("redo", {
		description: "Redo the latest undone message, restoring it and its response to active context",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			const turn = redoTurns.pop();
			if (!turn) return ctx.ui.notify("Nothing to redo", "info");

			const snap = turn.snapshotId ? redoStack.find((s) => s.id === turn.snapshotId) : undefined;
			if (snap) {
				await applyPatch(snap.basePatch, false);
				await applyPatch(snap.untrackedPatch, false);
				snap.undone = false;
				redoStack.splice(redoStack.indexOf(snap), 1);
				pi.appendEntry(TYPE, snap);
			}

			if (ctx.sessionManager.getEntry(turn.restoreEntryId)) await ctx.navigateTree(turn.restoreEntryId, { summarize: false });
			ctx.ui.setStatus("undo-redo", `undo: ${snapshots.filter(s => !s.undone).length}`);
			ctx.ui.notify(`Redone message + response${snap ? ` and ${snap.files.length} file(s)` : ""}`, "success");
		}
	});
}
