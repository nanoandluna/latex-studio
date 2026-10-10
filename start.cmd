@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or newer, then run this launcher again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo This release requires Node.js 22.13 or newer.
  pause
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo Install pnpm with: npm install -g pnpm@11.18.0
  pause
  exit /b 1
)
if not exist node_modules (
  call pnpm install --prod --frozen-lockfile
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Open http://localhost:3210 after the server starts. Keep this window open.
call pnpm start
if errorlevel 1 pause
