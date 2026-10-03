#!/usr/bin/env bash
# Sets Friends up on this computer (Linux): installs its dependencies, adds a
# `friends-web` command and an application-menu entry, then checks everything.
# No sudo needed; nothing is installed outside your home folder.
#
#   ./scripts/install.sh               install (or repair)
#   ./scripts/install.sh --desktop     also get Electron, for `npm run desktop` / `npm run dist`
#   ./scripts/install.sh --voice       also set up local voice (listening and speaking offline, ~1 GB)
#   ./scripts/install.sh --uninstall   remove the command and menu entry (your chats stay)
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
BIN="$HOME/.local/bin/friends-web"
ENTRY="$HOME/.local/share/applications/friends-web.desktop"
DATA="${FRIENDS_DATA_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/friends}"

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$BIN" "$ENTRY"
  command -v update-desktop-database >/dev/null && update-desktop-database -q "$HOME/.local/share/applications" || true
  say "✓ Removed the friends-web command and menu entry."
  say "  Your chats, notes and settings are still in $DATA"
  say "  (delete that folder to remove them too). To remove the app, delete $APP_DIR."
  exit 0
fi

# 1. Node.js 20 or newer
command -v node >/dev/null || die "Node.js isn't installed. Install version 20 or newer from https://nodejs.org (or: nvm install --lts), then run this again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || die "Node.js $(node -v) is too old; Friends needs 20 or newer (https://nodejs.org or: nvm install --lts)."
command -v npm >/dev/null || die "npm isn't installed (it comes with Node.js)."
say "✓ Node.js $(node -v)"

# 2. Dependencies (the desktop app's Electron only when asked: it is about 100 MB)
if [[ "${1:-}" == "--desktop" || "${2:-}" == "--desktop" ]]; then
  npm ci --no-audit --no-fund
  node node_modules/electron/install.js
  say "✓ Desktop app ready: npm run desktop   (or npm run dist for an installable .deb)"
else
  npm ci --omit=dev --no-audit --no-fund
fi
say "✓ Dependencies installed"

# 2b. Local voice, only when asked (about 1 GB; needs Python 3.9+ with venv)
if [[ "${1:-}" == "--voice" || "${2:-}" == "--voice" ]]; then
  node scripts/local-voice.js || say "! Local voice wasn't set up (see above). You can try again later: npm run voice:setup"
fi

# 3. The `friends-web` command: starts the helper in the background (if it isn't
#    running) and opens it in your browser
mkdir -p "$(dirname "$BIN")" "$(dirname "$ENTRY")" "$HOME/.cache/friends"
cat > "$BIN" <<LAUNCHER
#!/usr/bin/env bash
# Starts Friends and opens it in your browser. "friends-web --stop" stops it.
PORT="\${PORT:-3000}"
URL="http://localhost:\$PORT"
running() { curl -fs -m 2 "\$URL/api/health" >/dev/null 2>&1; }
if [[ "\${1:-}" == "--stop" ]]; then
  [[ -f "$HOME/.cache/friends/pid" ]] && kill "\$(cat "$HOME/.cache/friends/pid")" 2>/dev/null && echo "Friends stopped." || echo "Friends isn't running (from this command)."
  exit 0
fi
if ! running; then
  cd "$APP_DIR" || exit 1
  PORT="\$PORT" nohup node server/server.js >> "$HOME/.cache/friends/server.log" 2>&1 &
  echo \$! > "$HOME/.cache/friends/pid"
  for _ in \$(seq 1 40); do running && break; sleep 0.25; done
fi
running || { echo "Friends didn't start. See $HOME/.cache/friends/server.log"; exit 1; }
xdg-open "\$URL" >/dev/null 2>&1 || echo "Open \$URL in your browser."
LAUNCHER
chmod +x "$BIN"

cat > "$ENTRY" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Friends (browser)
Comment=Your personal AI chat, in your browser
Exec="$BIN"
Icon=$APP_DIR/build/icon.png
Terminal=false
Categories=Network;Chat;
DESKTOP
command -v update-desktop-database >/dev/null && update-desktop-database -q "$HOME/.local/share/applications" || true
say "✓ Added the friends-web command and a \"Friends (browser)\" menu entry"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) say "  (add \$HOME/.local/bin to your PATH to use the command by name)" ;; esac

# 4. Check everything
say ""
node scripts/doctor.js || true
say ""
say "Start it with:  friends-web      (or: npm start, then open http://localhost:3000)"
say "Then: Settings → AI control. A local AI (Ollama...) shows up there by itself."
