#!/bin/zsh
set -e
cd "$(dirname "$0")"
if ! command -v npm >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v npm >/dev/null 2>&1; then
  print 'Node.js is required. Install the LTS release from https://nodejs.org/ and reopen this launcher.'
  read '?Press Return to close.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run dev -- --open
