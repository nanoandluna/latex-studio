# Changelog

All notable changes to LaTeX Studio. Versions follow semver; every release gate
(`pnpm release:check`) runs the full unit + integration + security + real-LaTeX
+ E2E suite before a version is tagged.

## 0.5.0 — Research Writing Workspace

Focus: the paper becomes a first-class object. Four modules, all derived from
the existing Project Graph — no new scanning infrastructure.

### Paper Overview
- **Paper Overview** dashboard (Navigator → Overview): structure, content
  (CJK/Latin), assets, references (with undefined citations/references
  surfaced in amber) and live diagnostics — plus a per-chapter breakdown
  (CJK, citations, figures/tables/equations) whose rows jump to the source.
  `GET /api/paper/overview`; zero second scans.

### Citation Workspace
- **Citation Workspace** (Navigator → Citations): All / Used / Unused /
  Undefined / Duplicate groups with per-key bib metadata, first usage and
  usage locations. Each usage carries chapter/section attribution and a
  one-line citation context. `Open Bib` and `Show Usages` actions. Strictly
  read-only — the .bib file stays with Zotero / Better BibTeX.
- Duplicate bib keys are now flagged by the parser instead of being dropped
  silently.

### Reading Workspace
- **PDF thumbnails** rail (lazy-rendered, click to jump, current page marked).
- **Outline rail** — the paper's sections; clicking jumps to the mapped PDF
  page via SyncTeX.
- **Reading position** persisted per workspace (`reading-state.json`) and
  restored when the PDF reopens.

### Terminology Consistency
- **Terminology** (Navigator → Terms): user-defined preferred terms with
  variants / acronyms / forbidden forms; rule-based whole-word scan flags
  inconsistencies with file:line and context (no AI). Hits merge into the
  Problems panel and are clickable.

### Search → Context
- Project search results are annotated with the section they appear in.

### Under the hood
- Navigator sub-views moved into the ui store — palette commands can open
  them before the panel mounts (fixes a silent dispatch-then-listen race).

## 0.4.2 — UX & Release Polish

Focus: comfort for long writing sessions, a usable diff, honest status, and a
consistent release. No new research features by design.

### Fixes (post-tag follow-ups folded into this release)
- The main editor now registers its LaTeX language and dark theme up front —
  a first mount used to fall back to a light editor in dark mode until the
  History panel had been opened.
- A concurrent double-click can no longer open duplicate editor tabs.

Focus: comfort for long writing sessions, a usable diff, honest status, and a
consistent release. No new research features by design.

### Diff
- Snapshot diffs now open as a read-only tab in the **main editor area**
  (`Diff: <snapshot> → Now`) instead of a ~240 px sidebar column.
- **Changes rail** lists every file the snapshot touches (M/A/D); clicking a
  file switches the diff. Side-by-side by default, automatically **unified**
  when the pane is narrow.
- Diff tabs are pure views: closing them never touches the snapshot, the
  working tree, or the project graph.

### Interface
- **Header simplified** to the high-frequency core (workspace, project search,
  build, settings). Compiler, main file, auto-compile, auto-save, snapshot-on-
  blur, theme and the LaTeX environment moved into a single ⚙ settings menu —
  all still reachable from the command palette.
- **Typography**: editor font/line-height tokens (14 px / 1.5) applied to the
  editor and diff views; sidebar and panel body text raised from 10–11 px to
  12–13 px for long reading sessions. PDF zoom remains user-controlled.
- New command-palette commands: Search in Project, Show Statistics, Export
  Project (ZIP), Import Project (ZIP), Toggle PDF Preview, Toggle Problems
  Panel.

### Status visibility
- Status bar now shows **save state** (Saved / Unsaved changes / Saving… /
  Save failed), **last snapshot age** (or "No snapshot yet"), and the build
  state with compiler and a live elapsed timer — typed states, no string
  sniffing, no fake progress percentages.
- An indeterminate progress bar runs while a build is in flight; Cancel stays
  visible the whole time.

### Recovery
- Workspace switches now reset the diff view, snapshot history, statistics,
  and search results so nothing leaks between projects.
- Fixed: the main editor registered its LaTeX language/theme only after the
  History panel had been opened — first mount fell back to a light editor in
  dark mode without syntax highlighting.
- Fixed: clean editor tabs now re-sync after Restore / Replace All rewrites
  the disk; tabs with unsaved edits keep the user's buffer.

## 0.4.1 — Hardening

Review-hardening release: P0 partial-restore fix (files created after a
snapshot survive a partial restore), fs.watch bulk-write performance overhaul
(replace-apply 5.8 s → ~0.7 s), full search → replace → snapshot → diff →
restore E2E coverage, auto-save settings entry points, structured 404
envelope, replace-rollback failure reporting.

## 0.4.0 — Writer's Safety + Search

Snapshot / History / Diff / Restore, project-wide Search & Replace with
preview-confirm-apply, paper statistics (CJK + Latin, three-level
aggregation), auto-save policies, ZIP export/import.

## 0.3.x — Research Workspace Intelligence

Project Graph, live diagnostics, index-based completions, writing checks,
multi-bibliography support, SyncTeX loop, E2E suite.

## 0.2.x — LaTeX IDE Intelligence + Compatibility Final

Incremental parsing, outline/navigator, build queue stability, security
hardening (path jail, instance tokens, structured errors).

## 0.1.x — Local LaTeX Foundation

Edit → compile → preview loop, project workspace, PDF.js preview, real LaTeX
compiler detection.
