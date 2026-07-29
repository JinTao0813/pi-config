# pi-config

Personal Pi coding agent setup. Intended to be cloned directly into:

```txt
~/.pi/agent
```

Pi auto-loads extensions, skills, prompts, themes, and global prompt files from that directory.

`APPEND_SYSTEM.md` appends a short global style instruction without replacing Pi's default system prompt.

## What's included

### Extensions

- `web-research` — shared Tavily → Firecrawl → DuckDuckGo search engine exposed through the compact `webResearch` tool.
- `auto-research` — research/discovery workflows that reuse the shared web engine and write artifacts under Pi research storage.
- `browser-use` — browser automation support.
- `erd-designer` — ERD/schema review helpers.
- `permission-guards` — safety guards for risky actions.
- `token-ledger` — token/cache/skill/context audit utilities.
- `undo-redo` — undo/redo support.
- `usage` — `/usage` command for live Codex subscription usage via ChatGPT WHAM.
- `usage-statusline` — live footer status for context + Codex session/week usage; polls ChatGPT WHAM and supports `/usage-refresh`.
- `shared/env` — shared helper for reading extension env from `~/.pi/agent/.env`.

### Skills

Skills are bundled locally or linked from the companion `~/.agents/skills` installation.

#### Newly added workflow and writing skills

- `ask-matt` — route a situation to the appropriate engineering skill or flow.
- `grill-me` — explicitly start a relentless plan/design interview.
- `grilling` — stress-test an idea or decision one question at a time.
- `resolving-merge-conflicts` — resolve an active merge or rebase while preserving both intents.
- `setup-matt-pocock-skills` — configure issue tracking, triage labels, and domain-document conventions.
- `ubiquitous-language` — extract and formalize a DDD-style project glossary.
- `wayfinder` — map work too large for one session into decision tickets.
- `writing-shape` — turn fixed raw material into a structured article.

#### Newly added Remotion skills

- `remotion-captions` — transcribe, display, and animate captions.
- `remotion-create` — scaffold a Remotion project and composition.
- `remotion-docs` — find current Remotion documentation.
- `remotion-interactivity` — structure markup for Studio selection and manipulation.
- `remotion-maps` — choose and implement map-animation techniques.
- `remotion-markup` — apply Remotion content, animation, and effects practices.
- `remotion-multimedia` — work with video and audio through Mediabunny.
- `remotion-render` — render and export Remotion videos.
- `remotion-saas` — build applications backed by Remotion rendering.
- `remotion-upgrade` — upgrade Remotion, Mediabunny, and related skills safely.

Existing bundled and linked skills include `code-review`, `codebase-design`, `design-an-interface`, `diagnosing-bugs`, `domain-modeling`, `frontend-design`, `gpt-image-2`, `grill-with-docs`, `handoff`, `implement`, `impeccable`, `improve-codebase-architecture`, `prototype`, `remotion-best-practices`, `research`, `session-to-html`, `tdd`, `teach`, `to-spec`, `to-tickets`, `triage`, `writing-great-skills`, and `zoom-out`.

### Themes

- `catppuccin-mocha`

## Configure `.env`

Local extension secrets live in:

```txt
~/.pi/agent/.env
```

Create it from the example:

```bash
cd ~/.pi/agent
cp .env.example .env
$EDITOR .env
```

Optional web-research providers:

```bash
# Tavily is tried first when configured.
TAVILY_API_KEY=tvly-...

# Firecrawl is tried second when configured.
FIRECRAWL_API_KEY=fc-...
```

Without either key, web research uses DuckDuckGo. Results are filtered, deduplicated, and ranked before fallback is decided. `depth: "read"` currently degrades explicitly to labeled search snippets; bounded page-content reading is not implemented yet.

Useful Codex usage settings:

```bash
# Optional; defaults shown
CODEX_USAGE_PROVIDER=openai-codex
CODEX_USAGE_URL=https://chatgpt.com/backend-api/wham/usage
PI_CODEX_USAGE_STATUS_TTL_SECONDS=300
PI_CODEX_USAGE_STATUS_POLL_SECONDS=300
```

Codex usage reads live ChatGPT WHAM data using Pi `/login` auth. Run `/usage` for a detailed snapshot or `/usage-refresh` to force-refresh the footer.

This repo's custom extensions read `~/.pi/agent/.env` directly. Model/provider auth is separate: use Pi's normal `/login`, `auth.json`, or exported env flow.

## Quickstart setup

```bash
mv ~/.pi/agent ~/.pi/agent.backup 2>/dev/null || true
mkdir -p ~/.pi
git clone https://github.com/JinTao0813/pi-config.git ~/.pi/agent
cd ~/.pi/agent
cp .env.example .env
$EDITOR .env
pi
```

If you had an existing Pi setup, copy back only local/private files you still need, such as `auth.json`, `.env`, or `settings.json`.

## Updating an existing clone

```bash
cd ~/.pi/agent
git pull
```

Then restart Pi or run:

```text
/reload
```
