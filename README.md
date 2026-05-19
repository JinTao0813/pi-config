# pi-config

Personal Pi coding agent setup. Intended to be cloned directly into:

```txt
~/.pi/agent
```

Pi auto-loads extensions, skills, prompts, and themes from that directory.

## What's included

### Extensions

- `web-search` — `webResearch` tool using Tavily, with DuckDuckGo fallback.
- `auto-research` — research/discovery tools that write artifacts under Pi research storage.
- `browser-use` — browser automation support.
- `erd-designer` — ERD/schema review helpers.
- `permission-guards` — safety guards for risky actions.
- `token-ledger` — token/cache/skill/context audit utilities.
- `undo-redo` — undo/redo support.
- `usage` — Codex usage display command.
- `lib/env` — shared helper for reading extension env from `~/.pi/agent/.env`.

### Skills

- `caveman`
- `diagnose`
- `gpt-image-2`
- `grill-me`
- `grill-with-docs`
- `impeccable`
- `improve-codebase-architecture`
- `prototype`
- `setup-matt-pocock-skills`
- `tdd`
- `to-issues`
- `to-prd`
- `triage`
- `ui-ux-pro-max`
- `uncodixfy`
- `write-a-skill`
- `zoom-out`

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

Useful web search setting:

```bash
TAVILY_API_KEY=tvly-...
```

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
