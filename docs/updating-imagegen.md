# Updating the ImageGen skill

`skills/imagegen/` is a vendored copy of OpenAI Codex's public ImageGen sample skill:

- Repository: <https://github.com/openai/codex>
- Upstream directory: [`codex-rs/skills/src/assets/samples/imagegen`](https://github.com/openai/codex/tree/main/codex-rs/skills/src/assets/samples/imagegen)
- License: Apache-2.0; the upstream `LICENSE.txt` is retained in `skills/imagegen/`
- Current baseline: `d6407d735942c7cfc996aa2bc7d0f97fc8f0e4bf`

At that baseline, the vendored directory is an exact upstream mirror. This repo does not maintain a forked patch set.

## Maintenance policy

1. Mirror the complete upstream directory, including assets, references, scripts, agent metadata, and `LICENSE.txt`.
2. Do not make routine local edits inside `skills/imagegen/`. Put Pi-specific explanation in this document instead.
3. Review upstream changes before copying them. Skill Markdown is executable agent policy, and Python files can make network requests or write files.
4. Keep updates in a dedicated commit so provenance and later comparisons remain clear.
5. Record the new full upstream commit SHA in this document.

`SKILL.md` tells an agent not to modify `scripts/image_gen.py` during normal image-generation work. That runtime rule does not prevent a maintainer from replacing the script with a reviewed newer upstream version.

## Update procedure

Start from a clean branch and fetch the source with sparse checkout:

```bash
repo_root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)

git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/openai/codex.git "$tmp/codex"
git -C "$tmp/codex" sparse-checkout set \
  codex-rs/skills/src/assets/samples/imagegen
git -C "$tmp/codex" checkout

upstream_sha=$(git -C "$tmp/codex" rev-parse HEAD)
echo "$upstream_sha"
```

Inspect upstream history and the local delta before replacing anything:

```bash
git -C "$tmp/codex" log -n 20 -- \
  codex-rs/skills/src/assets/samples/imagegen

diff -ruN \
  "$repo_root/skills/imagegen" \
  "$tmp/codex/codex-rs/skills/src/assets/samples/imagegen" || true
```

Review changes for:

- tool names and host assumptions (`image_gen`, `view_image`, `$CODEX_HOME`);
- required environment variables and model names;
- supported CLI arguments and output formats;
- network endpoints and dependency changes;
- file-write, overwrite, and transparency behavior;
- prompt-injection and untrusted-input guidance;
- license or attribution changes.

After review, mirror the directory exactly:

```bash
rsync -a --delete \
  "$tmp/codex/codex-rs/skills/src/assets/samples/imagegen/" \
  "$repo_root/skills/imagegen/"
```

Update `Current baseline` above to `$upstream_sha`.

## Validation

Confirm there is no unexplained local fork before removing the temporary clone:

```bash
diff -qr \
  "$tmp/codex/codex-rs/skills/src/assets/samples/imagegen" \
  "$repo_root/skills/imagegen"
```

Validate Python syntax without creating `__pycache__` files:

```bash
python3 - <<'PY'
import ast
from pathlib import Path

for path in Path("skills/imagegen").rglob("*.py"):
    ast.parse(path.read_text(), filename=str(path))
    print(f"ok: {path}")
PY
```

Finish with repository checks:

```bash
git diff --check
git status --short
git diff --stat
git diff -- skills/imagegen docs/updating-imagegen.md README.md
```

Manually verify that all relative links in `SKILL.md` and `references/*.md` resolve and that `skills/imagegen/LICENSE.txt` remains present. Then remove the temporary checkout:

```bash
rm -rf "$tmp"
```

## Commit convention

Use a focused commit that names the upstream baseline:

```bash
git add skills/imagegen docs/updating-imagegen.md README.md
git commit -m "Update ImageGen skill from OpenAI Codex <short-sha>"
```

Do not mix unrelated local skills or generated images into that commit.
