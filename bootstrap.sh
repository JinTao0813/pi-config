#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v pi >/dev/null 2>&1; then
  echo "pi not found. Install @earendil-works/pi-coding-agent first." >&2
  exit 1
fi

pi install "$ROOT"

echo "Installed pi-config package from: $ROOT"
echo "Run /reload inside pi, or restart pi."
