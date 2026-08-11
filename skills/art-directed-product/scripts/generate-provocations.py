#!/usr/bin/env python3
"""Generate deterministic, orthogonal UI-prototype provocations."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from pathlib import Path

AXES = {
    "information_hierarchy": [
        "narrative-first",
        "task-first",
        "evidence-first",
        "comparison-first",
        "spatial-exploration-first",
    ],
    "composition": [
        "editorial split",
        "asymmetric canvas",
        "modular rail",
        "immersive sequence",
        "compact workspace",
    ],
    "primary_affordance": [
        "guided progression",
        "direct manipulation",
        "search and command",
        "side-by-side comparison",
        "layered disclosure",
    ],
    "density": [
        "sparse and theatrical",
        "calm and balanced",
        "dense and operational",
        "progressively disclosed",
        "rhythmic mixed density",
    ],
    "motion_character": [
        "restrained state feedback",
        "one staged signature",
        "scroll-linked narrative",
        "direct-response physics",
        "near-static editorial pacing",
    ],
    "media_relationship": [
        "type-led",
        "image-led",
        "interface-led",
        "data-led",
        "material-and-texture-led",
    ],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Derive reproducible UI exploration constraints from a design contract."
    )
    parser.add_argument("--contract", required=True, type=Path)
    parser.add_argument("--question", required=True)
    parser.add_argument("--variants", type=int, default=3, choices=range(2, 6))
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    return parser.parse_args()


def generate(contract: bytes, question: str, count: int) -> tuple[str, list[dict[str, str]]]:
    normalized_question = " ".join(question.split())
    if not normalized_question:
        raise ValueError("question must contain non-whitespace characters")

    digest = hashlib.sha256(contract + b"\0" + normalized_question.encode("utf-8")).hexdigest()
    rng = random.Random(int(digest[:16], 16))
    variants: list[dict[str, str]] = [dict() for _ in range(count)]

    for axis, choices in AXES.items():
        shuffled = choices.copy()
        rng.shuffle(shuffled)
        for index in range(count):
            variants[index][axis] = shuffled[index]

    return digest[:16], variants


def render_markdown(seed: str, question: str, variants: list[dict[str, str]]) -> str:
    lines = [
        f"Seed: `{seed}`",
        f"Question: {question.strip()}",
        "",
    ]
    for index, variant in enumerate(variants):
        lines.append(f"## Variant {chr(65 + index)}")
        for axis, value in variant.items():
            label = axis.replace("_", " ").title()
            lines.append(f"- **{label}:** {value}")
        lines.append("")
    return "\n".join(lines).rstrip()


def main() -> None:
    args = parse_args()
    contract = args.contract.read_bytes()
    seed, variants = generate(contract, args.question, args.variants)

    if args.format == "json":
        print(
            json.dumps(
                {
                    "seed": seed,
                    "question": " ".join(args.question.split()),
                    "variants": variants,
                },
                indent=2,
            )
        )
    else:
        print(render_markdown(seed, args.question, variants))


if __name__ == "__main__":
    main()
