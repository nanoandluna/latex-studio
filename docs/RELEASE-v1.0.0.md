# LaTeX Studio V1.0 — Reliable Research Writing

V1.0 completes the everyday path from writing and bibliography updates to PDF reading and recovery. It builds on the V0.5 research workspace, with a focus on preventing lost work and making a release usable outside the developer checkout.

## Writing and recovery

- Workspace-scoped browser sessions restore open tabs and unsaved text after reload or project switching.
- Per-file save queues mark only the bytes actually written as saved. Continuing to type during a save keeps the new text dirty.
- Atomic file publication avoids truncating the original file on a failed write. Optimistic disk checks reject stale editor buffers.
- A disk-conflict diff offers explicit choices to keep editing, use disk contents, or save the reviewed draft.
- Build saves every dirty tab first; a save failure prevents compiling an outdated paper.
- Snapshot restores validate manifests, file sizes and SHA-256 hashes before writes, and can recreate deleted files and parent folders. Matching files retain their timestamps without redundant writes. Extra sources are removed only after successful publication of every restored file.
- Text reads and mutations validate real filesystem paths, including ancestor junctions. Normalized root deletion and destination-overwriting renames are rejected.

## Research workflow

- Citation search by key, title, author, year and DOI; cursor insertion, copy and safe DOI/web links.
- Zotero / Better BibTeX exports refresh in the UI when the bibliography changes. No Zotero account or database access is required.
- Citation usages follow assembled include order and inherit chapters across `\input` files.
- A welcome screen explains the core workflow and checks the local TeX environment.
- Nested `\include` outputs work with TeX Live as well as MiKTeX. Direct compilation performs both post-bibliography passes; bibliography failures and cancellation are preserved in the build result and tool log.

## Distribution and maintenance

- Lazy editor and PDF loading, a bundled offline Monaco worker, and removal of unused language bundles and obsolete code.
- Patched runtime and test dependencies, with a dependency audit in the release gate.
- Cross-platform CI, strict real-LaTeX release verification, browser regression tests, and production authentication smoke checks.
- Cross-platform source monitoring handles directory deletion, ignores symlink targets and releases its handles when the server closes.
- A source-and-prebuilt ZIP, SHA-256 checksum, Windows/POSIX launchers, and Chinese quick-start/upgrade documentation.

## Requirements and scope

Node.js >=22.13, pnpm 11.18.0, and a local TeX distribution for compilation. The release ZIP is a Node application, not a native installer. First dependency installation needs internet access; the workspace operates offline afterward. Single user, single server workspace; no cloud collaboration or grammar service.

Browser recovery depends on the current browser profile, origin and available local storage. It complements saved-file snapshots and project exports. Snapshot publication is atomic per file, not one filesystem transaction over the entire project; disk failures are reported and the pre-restore snapshot is retained.

## Verification

The full release gate passed on Windows on 2026-10-10: build and type checks, 228 unit/integration checks, 9 production authentication checks, 18 real LaTeX compilation checks, and 42 browser checks. Two browser scenarios reserved for runs without TeX were skipped in this real-TeX gate. The real compilation suite covers XeLaTeX, pdfLaTeX, LuaLaTeX, BibTeX, Biber, Chinese text, Unicode paths and SyncTeX. The dependency audit reported no known vulnerabilities.
