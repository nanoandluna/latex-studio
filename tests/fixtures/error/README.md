# error fixture

Intentionally broken: `\undefinedcommand`, `\ref{no:such:label}`.
Expected: build fails; parser reports "Undefined control sequence" and
"Reference 'no:such:label' is undefined".
