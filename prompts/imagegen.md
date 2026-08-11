---
description: Generate or edit images through Codex CLI built-in ImageGen
argument-hint: "<request> [reference image paths]"
---

Generate or edit the requested raster image using Codex CLI's built-in ImageGen capability.

## Required transport

- Load the installed `imagegen` skill for prompt shaping, reference-image roles, validation, iteration, and project asset handling.
- Override only its execution transport: invoke `codex exec` so the nested Codex session uses its built-in `image_gen` tool.
- Do not check for `OPENAI_API_KEY`.
- Do not invoke the bundled `scripts/image_gen.py` Image API fallback.
- Do not substitute SVG, CSS, canvas, Sharp, screenshots, procedural drawing, or local compositing for requested AI image generation.
- Use the current Codex CLI login. Run Codex with `--ephemeral --sandbox workspace-write -C "$PWD"`.
- Attach each local visual reference with `-i <path>` and label its role clearly in the nested prompt.
- Issue one `codex exec` call per distinct image or variant.
- Tell nested Codex to save the selected output under `output/imagegen/` and not modify unrelated files.
- Capture its final message with `-o /tmp/codex-imagegen-result.txt`.
- Inspect every output. If correction is needed, make at most one targeted ImageGen iteration while repeating all invariants.
- For project-bound work, copy or derive the selected asset into its final workspace path and update consumers only when requested.
- Report the generation mode, final prompt, source output path, and final project asset paths.

A typical invocation is:

```bash
codex exec \
  --ephemeral \
  --sandbox workspace-write \
  -C "$PWD" \
  -i path/to/reference.png \
  -o /tmp/codex-imagegen-result.txt \
  "Use the installed imagegen skill and built-in image_gen tool. Generate the requested raster image, save the selected result to output/imagegen/<descriptive-name>.png, and do not use the Image API fallback or modify unrelated files."
```

Omit `-i` when there is no reference image. Never assume that an attached image is an edit target; label it as an edit target, visual reference, or supporting input.

## User request

${ARGUMENTS:-Ask me what image I want to generate or edit.}
