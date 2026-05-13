# pi-config

Personal Pi coding agent package: extensions, skills, prompts, themes.

## Setup on a new machine

Clone this repo anywhere you want. The directory does not matter.

```bash
git clone https://github.com/JinTao0813/pi-config.git /path/you/want/pi-config
cd /path/you/want/pi-config
./bootstrap.sh
```

Equivalent manual install:

```bash
pi install /path/you/want/pi-config
```

`pi install` writes that local absolute path into Pi's global settings:

```txt
~/.pi/agent/settings.json
```

Example setting:

```json
{
  "packages": [
    "/path/you/want/pi-config"
  ]
}
```

Then restart Pi or run inside Pi:

```text
/reload
```

Auth is not included. On a new machine, run `/login` or configure API keys separately.

## Layout

```txt
extensions/  # Pi TypeScript/JS extensions
skills/      # Agent Skills folders with SKILL.md
prompts/     # Prompt templates
themes/      # TUI themes
```

## Update

From wherever you cloned the repo:

```bash
cd /path/you/want/pi-config
git pull
pi update --extensions
```

Or restart Pi / run `/reload` after pulling.

## Do not commit

Secrets and machine state stay out of git:

- `~/.pi/agent/auth.json`
- sessions
- research/cache/storage
- `node_modules/`
- `.env*`
