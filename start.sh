#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Install Node.js 22.13 or newer.'; exit 1; }
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" || { echo 'Node.js 22.13 or newer is required.'; exit 1; }
command -v pnpm >/dev/null || { echo 'Install pnpm: npm install -g pnpm@11.18.0'; exit 1; }
if [ ! -d node_modules ]; then pnpm install --prod --frozen-lockfile; fi
echo 'Open http://localhost:3210 after the server starts. Keep this terminal open.'
exec pnpm start
