# pi-config

Personal configuration package for [Pi](https://pi.dev/), intended to be cloned directly into `~/.pi/agent`.

Pi auto-loads the package's extensions, skills, prompts, themes, and global prompt files. `APPEND_SYSTEM.md` adds a short global style instruction without replacing Pi's default system prompt.

## Design approach

This setup treats Pi as a small agent kernel and adds focused capabilities at its extension boundary. The custom extensions generally follow the same rules:

- **Thin adapters over maintained tools.** The browser extension delegates browser behavior to Vercel's `agent-browser` instead of rebuilding Playwright automation.
- **Small model-facing contracts.** Tools expose bounded schemas and compact results rather than entire provider APIs.
- **Deterministic ownership.** Browser sessions, temporary output, research artifacts, and telemetry have explicit owners and cleanup paths.
- **Evidence before synthesis.** Search and research preserve source URLs, evidence type, provider attempts, and stable citation IDs.
- **Graceful fallback.** Optional paid providers improve capability, but the basic web-search path still works without API keys.
- **Untrusted data stays untrusted.** Web pages and search excerpts are evidence, never agent instructions.
- **Local-first observability.** Token and research records are written locally; extension telemetry must not break the agent.

## Installation

```bash
mv ~/.pi/agent ~/.pi/agent.backup 2>/dev/null || true
mkdir -p ~/.pi
git clone https://github.com/JinTao0813/pi-config.git ~/.pi/agent
cd ~/.pi/agent
npm install --omit=peer
cp .env.example .env
$EDITOR .env
pi
```

If replacing an existing setup, copy back only private files you still need, such as `.env`, `auth.json`, or `settings.json`. Do not commit them.

### Install externally managed skills

Several entries under `skills/` are symlinks to skills installed by their upstream CLIs. Install those sources after cloning:

```bash
npx skills@latest add mattpocock/skills
npx skills add remotion-dev/skills
npx impeccable install
npx motion-ai
```

- `mattpocock/skills` supplies the linked engineering and workflow skills.
- `remotion-dev/skills` supplies the linked Remotion skills.
- `impeccable` installs or refreshes the Impeccable frontend skill.
- `motion-ai` installs or configures the Motion AI skill and integrations.

Review each installer's prompts and destination before accepting changes. Re-run the same command when updating its upstream-managed skills.

After changing extensions or configuration, restart Pi or run:

```text
/reload
```

## Custom extensions

### Browser automation — `extensions/browser-use/`

**Surface:** `browser` tool, `/browser-install`, and `/browser-doctor`.

**Inspiration:** [Vercel Labs' `agent-browser`](https://github.com/vercel-labs/agent-browser), especially its AI-oriented accessibility snapshot and `@ref` interaction workflow. The directory name is historical: this extension is not based on the separate [Browser Use](https://browser-use.com/) project.

**Direction:** keep the Pi integration thin while adding lifecycle and safety controls that a raw CLI invocation does not provide.

- Uses the pinned package-local executable first, then `PI_AGENT_BROWSER_EXECUTABLE`, then `PATH`.
- Parses command text into an argument vector and calls `pi.exec` directly; shell syntax is never evaluated.
- Namespaces every browser session to the current Pi session. Optional sub-sessions remain inside that namespace.
- Serializes commands per owned session to avoid races while allowing independent sessions to proceed separately.
- Blocks model-triggered install/upgrade, `close --all`, namespace escape, and wrapper-owned session overrides.
- Closes only owned sessions during shutdown.
- Embeds PNG/JPEG/WebP screenshots up to 10 MB. Large screenshots remain at their path.
- Bounds text output; full truncated output goes to a wrapper-owned OS temporary directory that is removed on shutdown.
- Treats stderr from a successful command as a labeled warning rather than discarding it.

Recommended interaction loop:

```text
open <url> → snapshot -i → interact with @refs → snapshot -i again
```

Use accessibility snapshots for interaction and screenshots for visual claims. Re-snapshot after state changes because refs can become stale. For version-matched advanced guidance, run `agent-browser skills get core` through the tool.

Install and diagnose the browser runtime after `npm install`:

```text
/browser-install
/browser-doctor
```

For authenticated or hardened sessions, configure upstream policy in `~/.agent-browser/config.json` or with `AGENT_BROWSER_ALLOWED_DOMAINS`, `AGENT_BROWSER_ACTION_POLICY`, and `AGENT_BROWSER_CONFIRM_ACTIONS`. Project-local `agent-browser.json` is honored only when Pi trusts the project.

### Current-web search — `extensions/web-research/`

**Surface:** `webResearch` tool.

**Inspiration:** the compact search interfaces offered by [Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search) and [Firecrawl](https://docs.firecrawl.dev/api-reference/endpoint/search), plus DuckDuckGo's HTML results as a no-key fallback. Pi's custom-tool API supplies the model-facing boundary.

**Direction:** one small, provider-neutral evidence contract rather than exposing provider-specific payloads to the model.

Provider order is:

1. Tavily, when `TAVILY_API_KEY` is configured;
2. Firecrawl, when `FIRECRAWL_API_KEY` is configured;
3. DuckDuckGo HTML search, requiring no key.

The shared engine:

- translates one request into provider-specific requests;
- validates and normalizes untrusted rows;
- applies exact-host/subdomain include and exclude filters;
- canonicalizes URLs and removes tracking parameters;
- deduplicates equivalent results;
- bounds excerpts and returns at most ten sources;
- assigns stable `[1]`, `[2]`, ... citation IDs;
- records each provider attempt, elapsed time, accepted count, and sanitized failure category;
- falls back on errors or insufficient usable results while retaining the best earlier attempt;
- propagates cancellation instead of silently continuing to another provider.

`depth: "read"` is reserved but currently degrades explicitly to labeled `search-snippet` evidence. Bounded page-content extraction is intentionally not pretended to exist.

### Research workflows — `extensions/auto-research/`

**Surface:** `research_topic` and `discover_opportunity` tools; `/research`, `/discover`, `/research-list`, `/research-index`, and `/research-open` commands.

**Inspiration:** the familiar deep-research pipeline—plan, retrieve, grade, deduplicate, synthesize—combined with evidence stores used in literature review. Scholarly retrieval uses [OpenAlex](https://openalex.org/), [Semantic Scholar](https://www.semanticscholar.org/product/api), [arXiv](https://info.arxiv.org/help/api/), and [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/).

**Direction:** make research inspectable and reusable instead of returning one opaque prose answer.

- Classifies topic research versus opportunity/market discovery.
- Creates deterministic task plans for overview, official sources, implementation, limitations, freshness, competition, pain, users, constraints, market, and validation as appropriate.
- Reuses the shared `web-research` engine rather than maintaining a second web-search stack.
- Queries paper providers independently so one failing source does not erase all scholarly evidence.
- Grades and reranks evidence, writes accepted and rejected evidence separately, and deduplicates canonical sources.
- Searches local research memory before external providers; `forceRefresh` bypasses a sufficiently strong cache.
- Writes a run plan, JSONL evidence, report, summary, metadata, and a reusable evidence index under `~/.pi/agent/research` by default.

The approach is deliberately artifact-first: the tool response points to the report and top sources, while the full reasoning inputs remain reviewable on disk.

### ERD review bundles — `extensions/erd-designer/`

**Surface:** `generate_erd_from_sql`, `generate_erd_from_dbml`, and `/erd-proposal`.

**Inspiration:** [DBML](https://dbml.dbdiagram.io/home/), [Mermaid ER diagrams](https://mermaid.js.org/syntax/entityRelationshipDiagram.html), and migration-review workflows where the schema and reviewer questions travel together.

**Direction:** generate deterministic, diffable schema proposals before optionally rendering a picture.

- Accepts PostgreSQL, MySQL, or SQLite SQL/DBML.
- Extracts tables, columns, primary keys, unique keys, and foreign keys.
- Writes source schema, generated SQL when starting from DBML, `erd.mmd`, `review.md`, and metadata.
- Warns about missing primary keys, likely-but-undeclared foreign keys, missing referenced tables, and nullable relationships.
- Optionally renders SVG/PNG through Mermaid CLI; the Mermaid source remains usable if rendering fails.
- Defaults output to `research/database-proposals/<name>/`.

The parsers intentionally cover proposal-oriented table definitions, not every dialect feature. Review generated SQL before treating it as a migration.

### Token and context diagnostics — `extensions/token-ledger/`

**Surface:** `/tokens` with `breakdown`, `cache`, `tools`, `skills`, `context`, `context-write`, `masking`, `export`, and `reset` subcommands.

**Inspiration:** Pi's lifecycle/provider hooks and the observability needed to understand prompt growth, cache behavior, tool-output cost, skill discovery, and context composition.

**Direction:** local audit instrumentation rather than remote analytics.

- Records session/turn events, prompt estimates, provider payload metadata, assistant usage, and tool-result size.
- Estimates which prompt sections consume tokens.
- Tracks stable-prefix hashes and cache read/write ratios.
- Audits skill registry size, context files, and observation masking.
- Compacts selected oversized tool observations before they consume more model context and records the compaction metadata.
- Redacts key/token/authorization-like fields and truncates huge values before serialization.
- Writes append-only JSONL under the active session's `token-ledger/` directory.
- Treats telemetry writes as best effort so diagnostics cannot break normal agent work.

Token section estimates use a simple character heuristic; provider-reported usage remains the authoritative measurement when available.

### Git-backed turn undo/redo — `extensions/undo-redo.ts`

**Surface:** `/undo` and `/redo`.

**Inspiration:** editor-style undo semantics, Pi's session tree, and Git's binary patch format.

**Direction:** undo both conversational state and visible file changes from the latest turn.

- Captures tracked and untracked binary patches around agent turns inside Git worktrees.
- Stores snapshot metadata in Pi custom session entries so it survives session reloads.
- `/undo` reverses the matching patch and navigates before the latest user turn.
- `/redo` reapplies the patch and restores the previous session leaf.

This is a convenience checkpoint, not a replacement for commits. The current implementation stores the visible post-turn patch; pre-existing dirty work can make turn attribution less precise. Commit or stash important work before relying on it.

### Codex usage — `extensions/usage/`

**Surface:** `/usage`, `/usage refresh`, and `/usage --json`.

**Inspiration:** Codex's subscription rate-window display and Pi's ability to reuse provider authentication obtained through `/login`.

**Direction:** show authoritative subscription windows when available, then degrade honestly.

The provider chain is:

1. ChatGPT's WHAM usage response using Pi's `openai-codex` auth;
2. an explicitly configured usage API;
3. local Pi session telemetry as an estimate;
4. a structured unavailable result.

The ChatGPT WHAM endpoint is an internal, undocumented interface and can change without notice. The extension validates recognizable fields, uses timeouts/caching, and labels fallback estimates rather than presenting them as subscription limits.

### Usage footer — `extensions/usage-statusline.ts`

**Surface:** custom footer and `/usage-refresh`.

**Inspiration:** Pi's built-in footer plus Codex's session/weekly quota bars.

**Direction:** combine repository/model context and subscription capacity in one low-noise footer.

It displays working directory, branch, session name, aggregate input/output/cache/cost data, model and thinking level, context-window use, and five-hour/weekly usage. WHAM data is cached and polled; stale cached data is labeled when refresh fails. The extension tears down its timer and footer on session shutdown.

### Shared environment loader — `extensions/shared/env.ts`

**Surface:** internal helper used by web and research extensions.

**Inspiration:** dependency-free `.env` loading and process-environment precedence.

**Direction:** keep extension secrets in `~/.pi/agent/.env` without coupling model/provider authentication to that file. Exported process values win; the local file is read once and cached. Pi model auth still uses `/login`, `auth.json`, or the normal provider environment flow.

## Skills

Bundled highlights:

- `frontend-design` — Anthropic's distinctive, brief-led frontend design guidance for building or reshaping interfaces.
- `gpt-taste` — Leonxlnx's strongly opinionated GPT/Codex frontend direction for high-variance layouts and GSAP-heavy motion.
- `imagegen` — OpenAI Codex's public ImageGen skill, mirrored under its Apache-2.0 license. It replaced the older local `gpt-image-2` skill. See [the update and provenance guide](docs/updating-imagegen.md).
- `impeccable` — manual-only frontend critique, audit, hardening, and optimization toolkit.
- `motion` — Motion/CSS animation practices, docs search, spring generation, performance audits, and transition previews.
- `session-to-html` — packages planning or discussion context into a polished standalone HTML document.

Other skills are either bundled locally or linked from the companion `~/.agents/skills` installation. Pi discovers them from `skills/` at startup.

### Frontend skill routing and provenance

- `frontend-design` is vendored from Anthropic's [`claude-code/plugins/frontend-design`](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design/skills/frontend-design) skill. Its upstream terms are retained in `skills/frontend-design/LICENSE.txt`.
- `gpt-taste` is vendored from Leonxlnx's [`taste-skill`](https://github.com/Leonxlnx/taste-skill/tree/main/skills/gpt-tasteskill) repository under the MIT license retained in `skills/gpt-taste/LICENSE.txt`.
- Both remain available for automatic model routing. `frontend-design` is the broad design lead; `gpt-taste` is best suited to deliberately expressive, motion-heavy work.
- `impeccable` sets `disable-model-invocation: true`. Invoke it explicitly for a second-pass review with `/skill:impeccable critique <target>` or `/skill:impeccable audit <target>`.

### ImageGen provenance

The complete `skills/imagegen/` directory comes from OpenAI's public [`openai/codex`](https://github.com/openai/codex) repository at `codex-rs/skills/src/assets/samples/imagegen`. The repository keeps upstream layout and `LICENSE.txt` intact so updates can be compared and mirrored cleanly. Local maintenance policy and the pinned baseline are documented in [`docs/updating-imagegen.md`](docs/updating-imagegen.md).

### Motion notes

The self-contained best-practice references work without an account. Documentation search, easing tools, transition editing, and MotionScore capabilities may require Motion's MCP servers or Motion+. See the skill's own guidance and [Motion AI Kit](https://motion.dev/docs/ai-kit).

## Theme

- `themes/catppuccin-mocha.json`

## Configuration

Local extension secrets live in `~/.pi/agent/.env`:

```bash
cd ~/.pi/agent
cp .env.example .env
$EDITOR .env
```

### Web and research

```bash
# Optional; provider priority is Tavily, then Firecrawl, then DuckDuckGo.
TAVILY_API_KEY=tvly-...
FIRECRAWL_API_KEY=fc-...

# Optional research tuning.
PI_AUTO_RESEARCH_MAX_SOURCES=8
PI_AUTO_RESEARCH_DIR=$HOME/.pi/agent/research
PI_AUTO_RESEARCH_WEB_PROVIDER=auto
PI_AUTO_RESEARCH_PAPER_PROVIDERS=openalex,semanticscholar,arxiv,crossref
PI_RESEARCH_CONTACT_EMAIL=you@example.com
SEMANTIC_SCHOLAR_API_KEY=
```

Set `PI_AUTO_RESEARCH_WEB_PROVIDER=none` to disable web retrieval for auto-research. DuckDuckGo remains the no-key fallback for direct `webResearch` calls.

### Browser

Set the browser executable before starting Pi if the package-local binary should not be used:

```bash
export PI_AGENT_BROWSER_EXECUTABLE=/absolute/path/to/agent-browser
```

### Codex usage

```bash
# Optional defaults shown.
CODEX_USAGE_PROVIDER=openai-codex
CODEX_USAGE_URL=https://chatgpt.com/backend-api/wham/usage
CODEX_USAGE_TIMEOUT_MS=15000
PI_CODEX_USAGE_STATUS_TTL_SECONDS=300
PI_CODEX_USAGE_STATUS_POLL_SECONDS=300

# Optional fallback usage API.
PI_CODEX_USAGE_ENDPOINT=https://example.com/usage
PI_CODEX_USAGE_API_KEY=...
PI_CODEX_USAGE_WEEK_START=monday
```

Codex usage uses Pi `/login` auth by default. Do not copy model access tokens into `.env` unless a specific external integration requires it.

## Testing

```bash
npm test
```

The test suite covers the browser wrapper's command/session boundaries and web-research normalization, fallback, cancellation, filtering, and provider adapters.

Useful pre-commit checks:

```bash
git diff --check
npm test
find extensions -type f \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' \) -print
```

## Updating an existing clone

```bash
cd ~/.pi/agent
git pull
npm install --omit=peer

# Refresh externally managed/symlinked skills as needed.
npx skills@latest add mattpocock/skills
npx skills add remotion-dev/skills
npx impeccable install
npx motion-ai
```

Review installer prompts before allowing replacements. Then restart Pi or run `/reload`. Browser CLI changes may also require `/browser-install` followed by `/browser-doctor`.

For the vendored OpenAI ImageGen skill, do not copy files ad hoc; follow [`docs/updating-imagegen.md`](docs/updating-imagegen.md) so the upstream commit, license, and complete directory remain traceable.
