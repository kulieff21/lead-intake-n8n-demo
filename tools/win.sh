#!/usr/bin/env bash
# Mirror the repo to a plain D:\ path and run a script with the Windows Node that n8n uses.
# (WSL cannot reach Windows localhost, and Windows node mangles the vault path.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIRROR=/mnt/d/ronin-work/n8n/mirror/lead-intake
NODE=/mnt/d/ronin-work/n8n/node/node.exe
mkdir -p "$MIRROR"
rsync -a --delete --exclude .git --exclude node_modules --exclude results "$ROOT/" "$MIRROR/"
cd "$MIRROR"
set +e
"$NODE" "$@"
code=$?
set -e
# Copy generated artifacts back.
rsync -a "$MIRROR/workflows/" "$ROOT/workflows/"
[ -d "$MIRROR/results" ] && rsync -a "$MIRROR/results/" "$ROOT/results/"
exit $code
