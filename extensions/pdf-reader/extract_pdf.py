#!/usr/bin/env python3
"""Deterministically extract text from a PDF using a pinned pypdf release."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import sys
import unicodedata

PINNED_PYPDF_VERSION = "6.15.0"
EMPTY_PAGE_TEXT = "[No extractable text on this page]"


def normalize_text(value: str) -> str:
    """Normalize platform-sensitive line endings and unstable trailing whitespace."""
    value = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))
    value = value.replace("\x00", "")
    lines = [line.rstrip(" \t") for line in value.split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract stable UTF-8 text from a PDF. Page numbers are 1-based and inclusive."
    )
    parser.add_argument("pdf", type=Path, help="input PDF")
    parser.add_argument("--output", type=Path, help="write text here and print sorted JSON metadata")
    parser.add_argument("--start-page", type=int, default=1, help="first page (default: 1)")
    parser.add_argument("--end-page", type=int, help="last page (default: final page)")
    parser.add_argument(
        "--mode",
        choices=("plain", "layout"),
        default="plain",
        help="plain reading order or layout-preserving extraction (default: plain)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        help="reject larger requested ranges; useful for bounded callers",
    )
    return parser.parse_args(argv)


def load_pdf_reader():
    try:
        installed = importlib.metadata.version("pypdf")
    except importlib.metadata.PackageNotFoundError as error:
        raise RuntimeError(
            f"pypdf {PINNED_PYPDF_VERSION} is required; install requirements.lock"
        ) from error
    if installed != PINNED_PYPDF_VERSION:
        raise RuntimeError(
            f"pypdf {PINNED_PYPDF_VERSION} is required for repeatable output; found {installed}"
        )

    logging.getLogger("pypdf").setLevel(logging.ERROR)
    from pypdf import PdfReader  # Imported only after the version check.

    return PdfReader


def extract(args: argparse.Namespace) -> tuple[str, dict[str, object]]:
    path = args.pdf.expanduser().resolve(strict=True)
    if not path.is_file():
        raise ValueError("input is not a regular file")
    if args.start_page < 1:
        raise ValueError("--start-page must be at least 1")
    if args.end_page is not None and args.end_page < args.start_page:
        raise ValueError("--end-page must be greater than or equal to --start-page")
    if args.max_pages is not None and args.max_pages < 1:
        raise ValueError("--max-pages must be at least 1")

    PdfReader = load_pdf_reader()
    reader = PdfReader(path, strict=False)
    if reader.is_encrypted:
        raise ValueError("encrypted PDFs are not supported")

    page_count = len(reader.pages)
    if page_count == 0:
        raise ValueError("PDF has no pages")
    if args.start_page > page_count:
        raise ValueError(f"--start-page {args.start_page} exceeds PDF page count {page_count}")

    end_page = min(args.end_page or page_count, page_count)
    selected_count = end_page - args.start_page + 1
    if args.max_pages is not None and selected_count > args.max_pages:
        raise ValueError(
            f"PDF has {page_count} pages; requested {selected_count}. "
            f"Select at most {args.max_pages} pages with --start-page and --end-page"
        )

    sections: list[str] = []
    empty_pages: list[int] = []
    for page_number in range(args.start_page, end_page + 1):
        page = reader.pages[page_number - 1]
        if args.mode == "layout":
            extracted = page.extract_text(extraction_mode="layout") or ""
        else:
            extracted = page.extract_text() or ""
        text = normalize_text(extracted)
        if not text:
            empty_pages.append(page_number)
            text = EMPTY_PAGE_TEXT
        sections.append(f"=== Page {page_number} of {page_count} ===\n{text}")

    output = "\n\n".join(sections) + "\n"
    encoded = output.encode("utf-8")
    metadata: dict[str, object] = {
        "bytes": len(encoded),
        "empty_pages": empty_pages,
        "end_page": end_page,
        "mode": args.mode,
        "page_count": page_count,
        "pages_extracted": selected_count,
        "sha256": sha256_file(path),
        "start_page": args.start_page,
    }
    return output, metadata


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        output, metadata = extract(args)
        if args.output:
            destination = args.output.expanduser().resolve()
            if destination == args.pdf.expanduser().resolve():
                raise ValueError("output path must differ from input PDF")
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
            temporary.write_text(output, encoding="utf-8", newline="\n")
            os.replace(temporary, destination)
            print(json.dumps(metadata, sort_keys=True, separators=(",", ":")))
        else:
            sys.stdout.write(output)
        return 0
    except Exception as error:
        print(f"pdf extraction failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
