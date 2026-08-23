# multi-file-bib fixture

Regression fixture for **sub-file bibliography directives**: `\bibliography{refs}`
lives inside `sections/backmatter.tex` (pulled in via `\input`), not in the main file.

Requires: any engine + bibtex.
Expected: build succeeds and bibtex runs (citation smith2025 resolves, no
undefined-citation warnings survive).
