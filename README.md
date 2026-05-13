# pi-config

Personal Pi coding agent package: extensions, skills, prompts, themes.

## Install

```bash
./bootstrap.sh
```

or:

```bash
pi install /Users/winnee/dev/pi-config
```

Then restart Pi or run:

```text
/reload
```

## Layout

```txt
extensions/  # Pi TypeScript/JS extensions
skills/      # Agent Skills folders with SKILL.md
prompts/     # Prompt templates
themes/      # TUI themes
```

## Update

```bash
cd /Users/winnee/dev/pi-config
git pull
pi update --extensions
```

## Do not commit

Secrets and machine state stay out of git:

- `~/.pi/agent/auth.json`
- sessions
- research/cache/storage
- `node_modules/`
- `.env*`
