import assert from "node:assert/strict";
import test from "node:test";

import {
  SessionQueue,
  assertCliSuccess,
  combineSuccessfulOutput,
  countSnapshotRefs,
  deriveSessionName,
  prepareCommand,
  screenshotPath,
  splitCommand,
} from "../extensions/browser-use/core.ts";

test("splitCommand parses shell-like quoting without invoking a shell", () => {
  assert.deepEqual(splitCommand(`fill @e3 "hello world" 'literal value' escaped\\ space`), [
    "fill",
    "@e3",
    "hello world",
    "literal value",
    "escaped space",
  ]);
});

test("splitCommand preserves empty quoted arguments and escaped quotes", () => {
  assert.deepEqual(splitCommand(`type @e1 "" 'it'\\''s' "say \\"hi\\""`), [
    "type",
    "@e1",
    "",
    "it's",
    'say "hi"',
  ]);
});

test("splitCommand preserves a trailing backslash", () => {
  assert.deepEqual(splitCommand("type @e1 value\\\\"), ["type", "@e1", "value\\"]);
});

test("splitCommand rejects an unclosed quote", () => {
  assert.throws(() => splitCommand(`fill @e1 "unfinished`), /Unclosed quote: "/);
});

test("deriveSessionName is stable, sanitized, and length-limited", () => {
  assert.equal(deriveSessionName("019FAD9E-E1A0"), "pi-019fad9e-e1a0");
  assert.equal(deriveSessionName("../../ My Session !!!"), "pi-my-session");
  assert.equal(deriveSessionName("x".repeat(100)).length, 48);
});

test("prepareCommand injects the owned session after supported global options", () => {
  assert.deepEqual(prepareCommand("--headed open https://example.com", "pi-abc"), {
    action: "open",
    argv: ["--headed", "--session", "pi-abc", "open", "https://example.com"],
    sessionName: "pi-abc",
  });
  assert.deepEqual(prepareCommand("--config policy.json --json snapshot -i", "pi-abc", "review_1"), {
    action: "snapshot",
    argv: ["--config", "policy.json", "--json", "--session", "pi-abc-review_1", "snapshot", "-i"],
    sessionName: "pi-abc-review_1",
  });
});

test("prepareCommand prevents escaping the wrapper-owned session", () => {
  assert.throws(() => prepareCommand("--session other open example.com", "pi-abc"), /session option/i);
  assert.throws(() => prepareCommand("open example.com --session=other", "pi-abc"), /session option/i);
  assert.throws(() => prepareCommand("--namespace other open example.com", "pi-abc"), /namespace option/i);
  assert.throws(() => prepareCommand("--json close --all", "pi-abc"), /close --all/i);
  assert.throws(() => prepareCommand("install", "pi-abc"), /browser-install/i);
  assert.throws(() => prepareCommand("upgrade", "pi-abc"), /browser-install/i);
  assert.throws(() => prepareCommand("doctor --fix", "pi-abc"), /browser-doctor/i);
  assert.throws(() => prepareCommand("", "pi-abc"), /Missing browser command/);
  assert.throws(() => prepareCommand("open example.com", "pi-abc", "../other"), /session suffix/i);
});

test("screenshotPath extracts plain and JSON output", () => {
  assert.equal(screenshotPath("✓ Screenshot saved to /tmp/capture.png"), "/tmp/capture.png");
  assert.equal(screenshotPath('{"success":true,"data":{"path":"/tmp/capture.webp"}}'), "/tmp/capture.webp");
  assert.equal(screenshotPath("done"), undefined);
});

test("countSnapshotRefs recognizes both forms without duplicates", () => {
  const snapshot = "@e1 button\n[ref=e2] input\n@e2 duplicate\nref=e15 link";
  assert.equal(countSnapshotRefs(snapshot), 3);
});

test("combineSuccessfulOutput keeps stdout primary and labels stderr warnings", () => {
  assert.equal(combineSuccessfulOutput("ok\n", "warning\n"), "ok\n\n[stderr warning]\nwarning");
  assert.equal(combineSuccessfulOutput("", "warning"), "[stderr warning]\nwarning");
  assert.equal(combineSuccessfulOutput("", ""), "");
});

test("assertCliSuccess throws capped diagnostics containing stdout and stderr", () => {
  assert.throws(
    () => assertCliSuccess({ code: 7, stdout: "partial", stderr: "fatal" }, "open"),
    /agent-browser open failed \(exit 7\)[\s\S]*stdout[\s\S]*partial[\s\S]*stderr[\s\S]*fatal/,
  );
  assert.doesNotThrow(() => assertCliSuccess({ code: 0, stdout: "ok", stderr: "" }, "open"));
});

test("SessionQueue runs same-session work in call order and survives failures", async () => {
  const queue = new SessionQueue();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = queue.run("pi-a", undefined, async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    throw new Error("expected failure");
  });
  const second = queue.run("pi-a", undefined, async () => {
    events.push("second");
    return 2;
  });
  const other = queue.run("pi-b", undefined, async () => {
    events.push("other");
    return 3;
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first:start", "other"]);
  releaseFirst();
  await assert.rejects(first, /expected failure/);
  assert.equal(await second, 2);
  assert.equal(await other, 3);
  assert.deepEqual(events, ["first:start", "other", "first:end", "second"]);
});
