import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const PYTHON = process.platform === "win32"
  ? join(ROOT, "extensions", "pdf-reader", ".venv", "Scripts", "python.exe")
  : join(ROOT, "extensions", "pdf-reader", ".venv", "bin", "python");
const SCRIPT = join(ROOT, "extensions", "pdf-reader", "extract_pdf.py");

function createTextPdf(path: string): void {
  const streams = [
    Buffer.from("BT /F1 12 Tf 72 720 Td (Hello deterministic PDF) Tj ET"),
    Buffer.from("BT /F1 12 Tf 72 720 Td (Second page) Tj ET"),
  ];
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.concat([Buffer.from(`<< /Length ${streams[0].length} >>\nstream\n`), streams[0], Buffer.from("\nendstream")]),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Length ${streams[1].length} >>\nstream\n`), streams[1], Buffer.from("\nendstream")]),
  ];

  const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    length += chunk.length;
  });
  const xref = length;
  const table = offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  chunks.push(Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}`
      + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  ));
  writeFileSync(path, Buffer.concat(chunks));
}

function run(args: string[]) {
  return spawnSync(PYTHON, [SCRIPT, ...args], { encoding: "utf8" });
}

const runtime = spawnSync(PYTHON, ["-c", "import pypdf; assert pypdf.__version__ == '6.15.0'"], { encoding: "utf8" });
const skip = runtime.status !== 0 ? "run /pdf-reader-install first" : false;

test("PDF extraction is stable and page-addressable", { skip }, () => {
  const directory = mkdtempSync(join(tmpdir(), "pdf-reader-test-"));
  try {
    const pdf = join(directory, "sample.pdf");
    const first = join(directory, "first.txt");
    const second = join(directory, "second.txt");
    createTextPdf(pdf);

    const firstRun = run([pdf, "--output", first]);
    const secondRun = run([pdf, "--output", second]);
    assert.equal(firstRun.status, 0, firstRun.stderr);
    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.equal(readFileSync(first, "utf8"), readFileSync(second, "utf8"));
    assert.equal(firstRun.stdout, secondRun.stdout);
    assert.equal(
      readFileSync(first, "utf8"),
      "=== Page 1 of 2 ===\nHello deterministic PDF\n\n=== Page 2 of 2 ===\nSecond page\n",
    );

    const range = run([pdf, "--start-page", "2", "--end-page", "2"]);
    assert.equal(range.status, 0, range.stderr);
    assert.equal(range.stdout, "=== Page 2 of 2 ===\nSecond page\n");

    const bounded = run([pdf, "--max-pages", "1"]);
    assert.equal(bounded.status, 1);
    assert.match(bounded.stderr, /requested 2\. Select at most 1 pages/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
