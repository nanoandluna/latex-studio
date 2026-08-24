# LaTeX Studio

A lightweight **local-first** LaTeX workspace: open a local `.tex` project in your browser, edit it with Monaco, compile with your local TeX distribution (XeLaTeX / pdfLaTeX / LuaLaTeX / latexmk), preview the PDF live, and jump from build errors straight to the offending source line.

> Local-first + Web UI + LaTeX IDE + PDF Preview — no cloud, no accounts, fully offline.

![LaTeX Studio — workspace with editor and PDF preview](docs/images/app.png)

## Features

- **Workspace** — open any local folder as a LaTeX project; file tree with create / rename / delete / refresh; automatic main-file detection (`main.tex`, then any file containing `\documentclass`); manual override in the toolbar.
- **Editor** — Monaco Editor with a custom LaTeX language (syntax highlighting, bracket matching, folding, minimap, search & replace), plus completions for `\begin{…}`, `\cite{…}` keys from your `.bib` files, `\ref/\label` keys, and `\includegraphics` paths.
- **Multi-file** — tabs, dirty-state markers (`main.tex *`), `Ctrl+S` save.
- **Compile** — latexmk or direct engines via an isolated CompilerService; single-flight build queue (new builds cancel the running one), 180 s timeout, output isolated to `.build/`.
- **PDF Preview** — PDF.js continuous scroll, zoom / fit-width / fit-page, page navigation, text search (jumps to page), rotate, download, fullscreen.
- **Problems** — LaTeX log parsing into errors / warnings / info (`Undefined control sequence`, `Missing $`, file not found, undefined citations/references, overfull boxes) with click-to-jump to source line.
- **Auto Compile** — debounced rebuild 1 s after each save.
- **Command Palette** — `Ctrl+Shift+P`: Build, Save, Open Workspace, Change Compiler, Reload Tree, Theme…
- **Themes** — dark (default) / light / system. Session state (workspace path, tabs, compiler, theme, layout) persists across reloads.

## Architecture

```text
┌──────────────────────────── Browser ────────────────────────────┐
│ React + Zustand stores (workspace/editor/build/preview/ui)      │
│ Explorer │ Monaco Editor │ PDF.js Preview │ Problems/Output     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP JSON API only
┌──────────────────────────────▼──────────────────────────────────┐
│ Fastify server                                                  │
│  routes: workspace · files · build · env · health               │
│  services: WorkspaceService · CompilerService · EnvService      │
│  security: safeResolve() — every path is jailed to the workspace│
└──────────────┬──────────────────────────────┬───────────────────┘
               ▼                              ▼
        Local filesystem              latexmk / xelatex / …
                                       (spawn, shell:false)
```

Monorepo layout:

```text
apps/
  web/                 React + Vite + Tailwind UI
  server/              Fastify API + compiler/workspace services
packages/
  shared/              shared TypeScript types
  latex-parser/        LaTeX log error parser + .bib/.tex key parsers
tests/
  fixtures/            basic · chinese · bibliography · error projects
  e2e/                 Playwright specs
```

Key principle: the frontend never touches the filesystem or spawns processes — everything goes through the API, and compilation lives behind a `CompilerService` that can later be swapped for a remote/cloud provider.

## Release Verification (v0.1.x)

### 1. Install a TeX distribution

- Windows: [MiKTeX](https://miktex.org) or [TeX Live](https://tug.org/texlive). latexmk additionally needs Perl ([Strawberry Perl](https://strawberryperl.com)) on Windows.
- macOS/Linux: TeX Live.

### 2. Verify the tools in a NEW terminal

```bash
xelatex --version
latexmk --version
```

### 3. Doctor

```bash
pnpm doctor          # human-readable, exit 0 = READY / exit 1 = NOT READY
pnpm doctor --json   # machine-readable for CI
```

### 4. Full release check (cross-platform, sets all env vars itself)

```bash
pnpm release:check
```

Equivalent to running: `doctor → typecheck → unit/integration tests → RUN_LATEX_TESTS=1 real-LaTeX tests → E2E_HAS_LATEX=1 real-build E2E → web+server builds`.

Individual real-LaTeX steps (no shell-syntax knowledge required):

```bash
pnpm test:latex       # real compilation: basic/chinese/multi-file/bibtex/biber/image/unicode-path/error + stale-PDF regression
pnpm test:e2e:latex   # real-build Playwright suite
```

### 5. Expected output

```text
Doctor               PASS
Typecheck            PASS
Unit/Integration     PASS
Real LaTeX           PASS
Real E2E             PASS
Web Build            PASS
Server Build         PASS

RESULT:
READY FOR v0.1.1
```

(The verdict line is generated from the root `package.json` version.)

Rules of the gate: without `RUN_LATEX_TESTS=1` real-compilation tests SKIP quietly (normal dev); **with** it, a missing TeX environment is a hard `BLOCKED` failure — a skip can never masquerade as a pass. Real build assertions check true artifacts: PDF exists, size > 0, header `%PDF-`, and a failed rebuild serves no PDF.

## Security

The server binds to 127.0.0.1 only and protects its API against localhost
CSRF / DNS-rebinding:

- **CORS** never reflects foreign origins (only same-origin + the Vite dev server may read responses).
- **Host allow-list** rejects DNS-rebinding requests (Host must be localhost / 127.0.0.1 / [::1] / this machine's hostname).
- **Instance token** — every browser page load receives an HttpOnly SameSite=Strict session cookie; all /api/* calls require it (or the x-latex-studio-token header). Automated tests run with NODE_ENV=test, which opts out of this layer.

Error shape is unchanged: { "error": { "code", "message" } } with new codes UNAUTHORIZED (401) / FORBIDDEN (403).
## Requirements

- Node.js ≥ 20 and pnpm ≥ 9
- A LaTeX distribution for compiling:
  - Windows: [MiKTeX](https://miktex.org) or [TeX Live](https://tug.org/texlive)
  - macOS/Linux: TeX Live (`latexmk`, `xelatex` recommended)

The app runs fine without LaTeX (you can browse/edit files), but building needs at least one engine on your `PATH`.

## Installation

```bash
pnpm install
```

## Run

Development (hot reload, web on :5173 proxied to :3210):

```bash
pnpm dev
# → http://localhost:5173
```

Production:

```bash
pnpm build
pnpm start
# → http://localhost:3210
```

Then: **Open Workspace** → pick a folder containing `.tex` files → edit → `Ctrl+S` → `Ctrl+B`.

## LaTeX Environment

On startup the header shows detection results for `latexmk`, `xelatex`, `pdflatex`, `lualatex`, `bibtex`, `biber` and `synctex` — hover to see the resolved absolute path and version of each tool. Detection order:

1. `PATH` lookup (`where` / `which`)
2. Common install locations (TeX Live `X:\texlive\<year>\bin\windows`, MiKTeX per-user/per-machine dirs, macOS `/Library/TeX/texbin`, POSIX `/usr/local/texlive/...`)
3. Extra user-configured directories:
   ```bash
   # env var
   set LATEX_STUDIO_EXTRA_PATH=D:\tex\bin
   # or ~/.latex-studio.json
   { "extraPaths": ["D:\\tex\\bin"] }
   ```

If nothing is found you'll see:

> ⚠ No LaTeX environment detected. Install TeX Live or MiKTeX and restart.

Diagnose your environment any time:

```bash
pnpm doctor
# prints Node/pnpm/tool availability, fixtures sanity, and READY / NOT READY
```

## Windows Setup

- Install MiKTeX or TeX Live and make sure its `bin` directory is on `PATH`. Verify in a **new** terminal:
  ```bat
  xelatex --version
  latexmk --version
  ```
- If `latexmk` is missing, choose `XeLaTeX` (or `Auto`) — the server falls back to running the engine directly and runs BibTeX/Biber passes itself based on the project's `\bibliography` / `\addbibresource` directives.
- Paths with spaces, CJK characters and drive letters (`D:\科研项目\我的论文`) are supported — compilation uses `spawn(executable, args, { shell: false })` with no shell string concatenation.
- Cancel kills the whole process tree (`taskkill /T /F`), so latexmk → xelatex → bibtex children never linger.

## Development

```bash
pnpm dev          # run everything
pnpm typecheck    # tsc across all packages
pnpm test         # unit + integration tests (vitest)
pnpm test:e2e     # Playwright (needs `npx playwright install` once)
```

## Testing

```bash
pnpm test          # unit + integration (no LaTeX required)
RUN_LATEX_TESTS=1 pnpm test   # real compilation tests (needs TeX Live / MiKTeX)
```

- `packages/latex-parser` — log parsing (undefined control sequence, missing `$`, file-not-found, citation/reference warnings, overfull/underfull, package errors, nested-file attribution) and bib/label extraction.
- `apps/server` — workspace CRUD routes, main-file detection, path-traversal security (`../`, absolute paths, drive letters), no-workspace guards, process manager (timeout/cancel/tree-kill against real child processes), build concurrency (single-flight, latest-wins).
- `tests/e2e` — Playwright specs `01`–`10` covering load → open → edit → save → build → PDF → problems → tabs → workspace switch. Build-dependent specs **skip loudly** (`SKIPPED: real LaTeX not installed`) unless `E2E_HAS_LATEX=1`. Run with:

```bash
pnpm test:e2e      # builds everything, starts the server, runs Playwright
```

Real-LaTeX unit tests assert true artifacts: PDF exists, size > 0, header starts with `%PDF-`.

## Error codes

All API errors are structured — the frontend never string-matches:

```json
{ "error": { "code": "COMPILER_NOT_FOUND", "message": "…" } }
```

Codes: `WORKSPACE_NOT_FOUND` · `WORKSPACE_NOT_OPEN` · `FILE_NOT_FOUND` · `PATH_FORBIDDEN` · `INVALID_FILE` · `INVALID_ARGUMENT` · `COMPILER_NOT_FOUND` · `BUILD_FAILED` · `BUILD_TIMEOUT` · `BUILD_CANCELLED` · `CONFLICT` · `INTERNAL_ERROR`

Build lifecycle states surfaced in the UI: `Ready → Building… → Build successful / Build failed / Cancelled / Timed out / No LaTeX compiler found`, plus notices such as *latexmk unavailable — using direct compiler mode*.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| “No LaTeX environment detected” | Install MiKTeX/TeX Live, reopen terminal so `PATH` updates, restart the server. |
| Build fails with `spawn ... ENOENT` | The chosen compiler isn't installed — switch compiler in the toolbar. |
| Chinese document shows blank glyphs | Use `ctexart`/`ctexbook` with XeLaTeX (the default). |
| Port 3210 busy | Set `PORT=<n>` env var before `pnpm start`. |
| Stale PDF after rebuild | Hard-refresh; each build URL is cache-busted, but the browser may cache the old tab state. |

## Known limitations (v0.1.1)

- Real-compilation paths (basic/chinese/multi-file/bibtex/biber/error fixtures) are fully automated via `RUN_LATEX_TESTS=1` but were **not executed on the development machine** — no TeX distribution was installed there. All such tests report `SKIPPED` honestly rather than passing.
- SyncTeX: forward search (Ctrl+Click source → PDF page) implemented behind the `synctex` CLI; inverse search (PDF → source) is interface-only, planned V0.2.
- PDF search highlights matches per text-item and jumps between them; it does not reflow across line-broken words split between items.
- Single workspace at a time; single user by design.
- Image files show in the tree but aren't visually previewed.

## Roadmap

- **V0.2 — LaTeX IDE Intelligence**: SyncTeX bidirectional search · Outline/Structure panel · Project Navigator (figures/tables/citations/labels) · **Project Index** (`packages/latex-index` — one incremental scanner feeding Outline, Navigator and IntelliSense) · context-aware IntelliSense 2.0 · PDF search highlight · image preview → [full plan](docs/V0.2-PLAN.md)
- **V0.3 — Research Workspace**: Bib intelligence (hover cards, citation diagnostics) · reference/figure inspectors · project diagnostics · templates
- **V0.4 — AI-native LaTeX**: error-fix / rewrite / explain / generate — driven by the Project Index, so the AI understands your whole paper, not just a text selection
- **V0.5 — Engineering**: Git integration, snapshots, version history, export
- Beyond: remote compiler, cloud workspace, collaboration (only if genuinely needed)
