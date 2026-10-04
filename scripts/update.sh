#!/usr/bin/env bash
# `npm run update`: turns this source folder into the installed desktop app.
# Checks and tests first (nothing is installed if they fail), backs up your
# data, builds dist/friends_<version>_amd64.deb and installs it with apt
# (asks for your password: installing a program needs root).
#   npm run update               the whole thing
#   npm run update -- --no-test  skip the tests (faster, for small changes)
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\033[1m%s\033[0m\n' "$*"; }
version=$(node -p "require('./package.json').version")

if [[ " $* " != *" --no-test "* ]]; then
  say "1/4 Checking and testing…"
  npm run --silent check
  log=$(mktemp)
  npm test --silent >"$log" 2>&1 || { tail -40 "$log"; echo "Tests failed; nothing was installed."; exit 1; }
  rm -f "$log"
else
  say "1/4 Skipping the tests"
fi

say "2/4 Backing up your data…"
node scripts/backup.js

say "3/4 Building Friends $version…"
npm run --silent dist

say "4/4 Installing (needs your password)…"
if pgrep -x friends >/dev/null; then echo "Friends is open: it keeps running the old version until you quit and start it again."; fi
sudo apt install -y --reinstall "./dist/friends_${version}_amd64.deb"
say "Done. Friends $version is installed."
