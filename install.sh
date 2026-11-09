#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${PI_MAIN_BIN_DIR:-$HOME/.local/bin}"
TARGET="$BIN_DIR/pi-main"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$TARGET"
  echo "Removed $TARGET"
  exit 0
fi

for command in pi node git; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "pi-main: missing required command: $command" >&2
    exit 1
  fi
done

chmod +x "$ROOT/bin/pi-main.mjs"
mkdir -p "$BIN_DIR"
ln -sfn "$ROOT/bin/pi-main.mjs" "$TARGET"

echo "Installed: $TARGET -> $ROOT/bin/pi-main.mjs"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Warning: $BIN_DIR is not on PATH. Add it to your shell profile." ;;
esac

if ! command -v gh >/dev/null 2>&1; then
  echo "Note: gh is not installed. The default GitHub tracker will not work;"
  echo "      set tracker.provider to \"local\" in pi-main.config.json or install gh."
fi

echo
echo "Next:"
echo "  cd <your-repo>"
echo "  pi-main"
echo
echo "Optional per-repo setup (once):"
echo "  /skill:setup-matt-pocock-skills"
