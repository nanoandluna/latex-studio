# LaTeX Studio

A **local-first research writing workspace** for graduate students and researchers: open a local `.tex` project in your browser, edit it with Monaco, compile with your local TeX distribution, preview the PDF live, search across your entire project, take snapshots before risky edits, and see live diagnostics without building.

> 面向研究生与科研人员的本地优先科研写作工作台。
> Local-first · offline · no account · single user.

![LaTeX Studio — workspace with editor and PDF preview](docs/images/app.png)

## Features

### Core editing & compilation

- **Workspace** — open any local folder; file tree with create / rename / delete / refresh; automatic main-file detection (`main.tex`, then `\documentclass` scan); manual override.
- **Editor** — Monaco Editor with custom LaTeX language (syntax highlighting, bracket matching, folding, minimap), index-driven completions (`\cite`, `\ref`, `\includegraphics`, environments, packages), hover cards for citations and labels.
- **Compile** — latexmk / XeLaTeX / pdfLaTeX / LuaLaTeX via isolated CompilerService; single-flight build queue; timeout; output isolated to `.build/`; automatic BibTeX/Biber passes.
- **Auto Compile** — debounced rebuild after each save.
- **SyncTeX bidirectional** — Ctrl+Click source → PDF page; Ctrl+Click PDF → exact source line.

### Project Intelligence *(V0.2–V0.3)*

- **Project Index** — incremental scanner tracking sections, labels, references, citations, figures, tables, equations, packages, includes; editor buffers re-indexed debounced without disk writes.
- **Outline & Navigator** — sidebar tabs: section tree with compiled numbering, whole-project navigator (figures / tables / equations / citations / labels) with usage-count badges and undefined/unused flags.
- **Live Diagnostics** — undefined references, duplicate labels, undefined citations appear in Problems without building.
- **Writing Checks** *(toggleable)* — repeated words, long sentences, TODO/FIXME, empty sections, suspicious punctuation.

### Writer's Safety *(V0.4)*

- **Snapshots** — atomic, SHA-256 verified, retention policy (max 30 + daily coalescing). Triggers: manual, pre-replace, pre-restore, build-ok (configurable).
- **History Browser** — timeline of all snapshots with per-file change summary.
- **Diff Viewer** — Monaco DiffEditor comparing any snapshot against current working tree.
- **Restore** — always writes a `pre-restore` safety snapshot first; validates every path through the workspace jail.
- **Replace All safety** — mandatory `pre-replace` snapshot before applying bulk replacements.

### Search & Statistics *(V0.4)*

- **Project Search** — `Ctrl+Shift+F`; case sensitivity, whole word, regex, glob filters; results grouped by file with click-to-jump.
- **Replace All** — preview → confirm → auto-snapshot → atomic apply.
- **Paper Statistics** — CJK characters · Latin words · numeric tokens counted separately; LaTeX commands/comments/math excluded; project/chapter/file aggregation.

### Portability *(V0.4)*

- **ZIP Export** — sources only (`.build/`, `.latex-studio/`, artifacts excluded).
- **ZIP Import** — path-jail validated, size-capped, refuses non-empty targets.

## Architecture

```text
┌───────────────────────────────────── Browser ────────────────────────────────────┐
│ React + Zustand stores (workspace/editor/build/index/preview/ui)                 │
│ Sidebar (Explorer·Outline·Navigator·Search·History) │ Monaco │ PDF.js │ Problems │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ HTTP JSON API only (instance-token auth)
┌──────────────────────────────────────▼───────────────────────────────────────────┐
│ Fastify server                                                                   │
│  routes: workspace · files(+raw) · index · build · synctex(fwd/inv/diag)         │
│          · snapshots(CRUD+diff+restore) · search(+replace) · statistics          │
│  services: WorkspaceService · CompilerService · ProjectIndexService              │
│            · FileWatcher · SnapshotStore                                         │
│  security: safeResolve() jail · safeRealpathInside() · Host allow-list           │
│            · instance token                                                      │
└────────────────┬──────────────────────────────┬─────────────────────────────────┘
                 ▼                              ▼
          Local filesystem               latexmk / xelatex / biber / synctex …
                                          (spawn, shell:false)

Project flow:
  LaTeX project ──▶ ProjectIndex ──▶ Outline / Navigator / IntelliSense
                         │                    │
                    diagnostics ─────────▶ Problems panel
```

Monorepo layout:

```text
apps/
  web/                 React + Vite + Tailwind UI
  server/              Fastify API + compiler/workspace/index/snapshot services
packages/
  shared/              shared TypeScript types
  latex-parser/        LaTeX parsers + project-index builder + text statistics
templates/             template packages (article · report · beamer · ieee · acm · chinese)
tests/
  fixtures/            basic · chinese · multi-file(+bib) · bibliography(-biber)
                       beamer · ieee · biblatex · chinese-thesis · research-thesis
                       image · unicode-path · error projects
  e2e/                 Playwright specs
scripts/               doctor · release-check · generate-large-project · security-smoke
```

Key principle: the frontend never touches the filesystem or spawns processes — everything goes through the API. All paths jailed via `safeResolve()` + `safeRealpathInside()`.

## Release Verification

### 1. Install a TeX distribution

- Windows: [MiKTeX](https://miktex.org) or [TeX Live](https://tug.org/texlive). latexmk additionally needs Perl ([Strawberry Perl](https://strawberryperl.com)).
- macOS/Linux: TeX Live.

### 2. Verify tools in a NEW terminal

```bash
xelatex --version
latexmk --version
```

### 3. Doctor

```bash
pnpm doctor          # human-readable, exit 0 = READY / exit 1 = NOT READY
pnpm doctor --json   # machine-readable for CI
```

### 4. Full release check

```bash
pnpm release:check
```

Runs: `doctor → typecheck → unit/integration → real-LaTeX tests → real-build E2E → web+server builds`.

Individual steps:

```bash
pnpm test:latex       # real compilation fixtures incl. stale-PDF regression
pnpm test:e2e:latex   # real-build Playwright suite
pnpm test:stress      # 500/1000-chapter performance benchmarks
```

### Expected output

```text
Doctor               PASS
Typecheck            PASS
Unit/Integration     PASS
Real LaTeX           PASS
Real E2E             PASS
Web Build            PASS
Server Build         PASS

RESULT:
READY FOR v<version>
```

Gate rules: without `RUN_LATEX_TESTS=1` real-compilation tests SKIP quietly; with it, missing TeX is hard `BLOCKED` — skips never masquerade as passes. Real assertions check `%PDF-` headers on disk, not just HTTP 200.

## Security

Binds to `127.0.0.1` only. Protects against localhost CSRF / DNS-rebinding:

- **CORS** never reflects foreign origins.
- **Host allow-list** rejects DNS rebinding.
- **Instance token** — HttpOnly SameSite=Strict cookie + `x-latex-studio-token` header required on all `/api/*`.
- **Path jail** — `safeResolve()` + `safeRealpathInside()` on every filesystem operation.
- **Structured errors** — `{ error: { code, message } }` throughout; frontend never string-matches.

Automated tests run with `NODE_ENV=test` (opts out of auth layer).

## Requirements

- Node.js ≥ 20, pnpm ≥ 9
- TeX distribution for compiling (MiKTeX / TeX Live; latexmk needs Perl on Windows)

## Installation & Run

```bash
pnpm install

pnpm dev              # development → http://localhost:5173

pnpm build && pnpm start   # production → http://localhost:3210
```

Open Workspace → pick folder → edit → `Ctrl+S` → `Ctrl+B`.

## Testing

```bash
pnpm test             # unit + integration (no LaTeX needed)
pnpm test:latex       # real compilation tests (needs TeX)
pnpm test:stress      # 500/1000-chapter performance benchmarks
pnpm test:e2e         # Playwright suite
pnpm release:check    # the full gate
```

## Developer Observability

`GET /api/graph/debug` exposes live Project Graph state — node/edge counts, revision, schema/parser versions, last-pass timings, recent watcher batches. Command Palette command dumps it to Output panel.

## Error codes

All API errors use `{ error: { code, message } }`:

`WORKSPACE_NOT_FOUND` · `WORKSPACE_NOT_OPEN` · `FILE_NOT_FOUND` · `PATH_FORBIDDEN` · `FORBIDDEN` · `UNAUTHORIZED` · `INVALID_FILE` · `INVALID_ARGUMENT` · `COMPILER_NOT_FOUND` · `BUILD_FAILED` · `BUILD_TIMEOUT` · `BUILD_CANCELLED` · `CONFLICT` · `SNAPSHOT_FAILED` · `REPLACE_FAILED` · `CONFIRMATION_REQUIRED` · `SEARCH_TIMEOUT` · `INVALID_ARCHIVE` · `PAYLOAD_TOO_LARGE` · `IMPORT_FAILED` · `EXPORT_FAILED` · `INTERNAL_ERROR`

Build states: `Ready → Building… → Build successful / Build failed / Cancelled / Timed out / No LaTeX compiler found`

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| “No LaTeX environment detected” | Install MiKTeX/TeX Live, reopen terminal, restart server. |
| Build fails with `spawn … ENOENT` | Switch compiler in toolbar. |
| Chinese document shows blank glyphs | Use `ctexart`/`ctexbook` with XeLaTeX. |
| Port 3210 busy | Set `PORT=<n>` env var. |
| SyncTeX jump does nothing | Rebuild once (needs `-synctex=1` output). |

## Known limitations (v0.4.1)

- PDF search highlights matches per text-item; hyphenation across line ends may still be missed.
- Single workspace at a time; single user by design.
- Per-file parse cache persists in `.latex-studio/cache/` (schema-gated); assembled graph rebuilt in memory each session.
- Spell/grammar checking not provided.
- Linux `fs.watch` non-recursive fallback relies on debounced mtime diff (not tested on real Linux).
- Project search scans raw file lines — comments and verbatim text are **not** excluded. Deliberate: Replace All must write back original lines, so search and replace must see the same text.
- Replace preview shows per-file counts rather than per-hunk before/after context; the real before/after is in History under the automatic `pre-replace` snapshot.
- Replace previews are held in memory for 10 minutes and are single-use; run Preview again after that.

## Roadmap

- ~~V0.1 — Local LaTeX Foundation~~ ✅
- ~~V0.1.x — Security / Hardening~~ ✅
- ~~V0.2.x — LaTeX IDE Intelligence~~ ✅
- ~~V0.3.x — Research Workspace Intelligence · Intelligence Hardening~~ ✅
- ~~V0.4.0 — Writer's Safety + Search~~ ✅ (Snapshot · History/Diff/Restore · Project Search & Replace · Paper Statistics · ZIP Export/Import)
- ~~V0.4.1 — Review hardening~~ ✅ (P0 partial-restore fix · fs.watch bulk-write perf overhaul · full search/replace/snapshot/restore E2E · auto-save settings UI)
- V0.4.2 — SSE Build Progress · large-project polish · crash recovery regression
- V0.5.0 — Research Writing Workspace: Citation Workspace · Terminology Consistency/Glossary · PDF Thumbnails · Reading Position Memory · 中文界面
- V0.6.0 — Literature Bridge: Zotero/Better BibTeX workflow deepening · literature PDF reading
- V0.7.0 — Long-term Reliability: snapshot format evolution · migration · backup/recovery hardening
- V1.0 — Graduate Research Workspace

Product razor: 只做让研究生更快、更稳定、更清晰地完成一篇高质量论文的功能。
