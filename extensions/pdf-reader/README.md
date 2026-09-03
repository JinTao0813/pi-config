# PDF reader extension

Registers `read_pdf`, a bounded Pi tool backed by a deterministic Python extractor.

## Why an extension

A custom tool gives Pi a typed PDF-reading operation, path resolution, cancellation, output truncation, and temporary-file cleanup. A skill alone would only tell the model to assemble shell commands repeatedly.

## Install Python runtime

From Pi:

```text
/pdf-reader-install
```

Or manually:

```bash
python3 -m venv extensions/pdf-reader/.venv
extensions/pdf-reader/.venv/bin/python -m pip install \
  --require-hashes --only-binary=:all: --no-deps \
  -r extensions/pdf-reader/requirements.lock
```

The lock pins both the pypdf version and wheel SHA-256. Set `PI_PDF_PYTHON` before starting Pi to use another interpreter; it must contain the exact pinned pypdf version.

## Standalone script

```bash
extensions/pdf-reader/.venv/bin/python extensions/pdf-reader/extract_pdf.py document.pdf
extensions/pdf-reader/.venv/bin/python extensions/pdf-reader/extract_pdf.py document.pdf \
  --start-page 1 --end-page 20 --mode layout --output document.txt
```

Page numbers are 1-based and inclusive. Without `--output`, extracted text goes to stdout. With `--output`, text is written atomically and sorted JSON metadata goes to stdout.

Output is normalized to UTF-8/NFC, LF line endings, no NULs, and no trailing horizontal whitespace. Stable page markers are included. Identical PDF bytes, pypdf version, Python runtime, arguments, and platform produce identical text.

Limitations: no OCR, password-protected PDFs, forms, image extraction, or table reconstruction. Scanned pages are labeled as having no extractable text.
