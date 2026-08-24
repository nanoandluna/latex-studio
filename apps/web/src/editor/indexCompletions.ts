import type * as Monaco from 'monaco-editor';
import { useProjectIndexStore } from '../stores/projectIndexStore';
import { LATEX_LANG_ID } from './latexLanguage';

const ENVIRONMENTS_BASE = [
  'document', 'itemize', 'enumerate', 'description', 'figure', 'figure*',
  'table', 'table*', 'tabular', 'tabularx', 'equation', 'align', 'align*',
  'gather', 'cases', 'theorem', 'proof', 'abstract', 'center', 'quote',
  'verbatim', 'minipage', 'thebibliography', 'lstlisting',
];

/** Packages that unlock extra environments (small curated map). */
const PACKAGE_ENVIRONMENTS: Record<string, string[]> = {
  amsmath: ['align', 'align*', 'gather', 'gather*', 'multline', 'cases'],
  algorithm2e: ['algorithm'],
  algorithmicx: ['algorithmic'],
  booktabs: [],
  listings: ['lstlisting'],
  tabularx: ['tabularx'],
};

function indexEnvironments(): string[] {
  const idx = useProjectIndexStore.getState().index;
  const set = new Set(ENVIRONMENTS_BASE);
  if (idx) {
    for (const p of idx.packages) {
      for (const env of PACKAGE_ENVIRONMENTS[p.name] ?? []) set.add(env);
    }
  }
  return [...set];
}

export function registerIndexCompletions(monaco: typeof Monaco): void {
  monaco.languages.registerCompletionItemProvider(LATEX_LANG_ID, {
    triggerCharacters: ['\\', '{'],
    provideCompletionItems: (model, position) => {
      const { index } = useProjectIndexStore.getState();
      const word = model.getWordUntilPosition(position);
      const lineContent = model.getLineContent(position.lineNumber);
      const beforeCursor = lineContent.slice(0, position.column - 1);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const K = monaco.languages.CompletionItemKind;
      const S = monaco.languages.CompletionItemInsertTextRule;

      // \cite-family — keys from the project bib index
      if (/\\(cite|citep|citet|citealp|autocite|textcite|parencite|footcite)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{[^}]*$/.test(beforeCursor)) {
        return {
          suggestions: (index?.bibEntries ?? []).map((b) => ({
            label: b.key,
            kind: K.Constant,
            detail: [b.author, b.year].filter(Boolean).join(', '),
            documentation: b.title ?? undefined,
            insertText: b.key,
            range,
          })),
        };
      }

      // \ref family — labels from the project index
      if (/\\(ref|pageref|eqref|autoref)\s*\{[^}]*$/.test(beforeCursor)) {
        return {
          suggestions: (index?.labels ?? []).map((l) => ({
            label: l.key,
            kind: K.Variable,
            detail: `${l.kind ?? 'label'} · ${l.file}:${l.line}`,
            insertText: l.key,
            range,
          })),
        };
      }

      // \includegraphics — figure files from the tree/index
      if (/\\includegraphics\s*(?:\[[^\]]*\])?\s*\{[^}]*$/.test(beforeCursor)) {
        const graphics = collectGraphics();
        return {
          suggestions: graphics.map((g) => ({
            label: g.path,
            kind: K.File,
            detail: g.detail,
            insertText: g.path,
            range,
          })),
        };
      }

      // \begin{ / \end{ — environments, package-aware
      if (/\\(begin|end)\{[a-zA-Z*]*$/.test(beforeCursor)) {
        const braceIdx = beforeCursor.lastIndexOf('{');
        const typed = beforeCursor.slice(braceIdx + 1);
        const start = position.column - 1 - typed.length; // 0-based col of '{'+1
        const envRange: Monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: start + 2, // inside the brace
          endColumn: position.column,
        };
        return {
          suggestions: indexEnvironments().map((env) => ({
            label: env,
            kind: K.Struct,
            insertText: env,
            range: envRange,
          })),
        };
      }

      // \usepackage{ — curated common packages + already-used ones first
      if (/\\usepackage\s*(?:\[[^\]]*\]\s*)?\{[^}]*$/.test(beforeCursor)) {
        const used = new Set(index?.packages.map((p) => p.name) ?? []);
        const common = [
          'amsmath', 'amssymb', 'amsthm', 'graphicx', 'booktabs', 'hyperref',
          'geometry', 'biblatex', 'natbib', 'cleveref', 'caption', 'subcaption',
          'algorithm2e', 'algorithms', 'listings', 'xcolor', 'tikz', 'pgfplots',
          'siunitx', 'microtype', 'enumitem', 'multirow', 'tabularx', 'ctex',
          'fontspec', 'unicode-math',
        ];
        const all = [...used, ...common.filter((c) => !used.has(c))];
        return {
          suggestions: all.map((name) => ({
            label: name,
            kind: K.Module,
            detail: used.has(name) ? 'already in preamble' : undefined,
            insertText: name,
            range,
          })),
        };
      }

      // \documentclass{
      if (/\\documentclass\s*(?:\[[^\]]*\]\s*)?\{[^}]*$/.test(beforeCursor)) {
        const classes = ['article', 'report', 'book', 'scrartcl', 'scrreprt', 'beamer', 'ctexart', 'ctexrep', 'ctexbook', 'IEEEtran', 'acmart', 'elsarticle'];
        return {
          suggestions: classes.map((c) => ({ label: c, kind: K.Class, insertText: c, range })),
        };
      }

      // backslash commands (kept from V0.1, trimmed)
      if (/\\[a-zA-Z]*$/.test(beforeCursor)) {
        const commands: [string, string?][] = [
          ['documentclass'], ['usepackage'], ['title'], ['author'], ['date'], ['maketitle'],
          ['section', '\\section{$1}'], ['subsection', '\\subsection{$1}'],
          ['subsubsection', '\\subsubsection{$1}'], ['textbf'], ['textit'], ['emph'],
          ['underline'], ['item'], ['footnote'], ['label'], ['ref'], ['eqref'], ['cite'],
          ['includegraphics', '\\includegraphics[width=0.8\\textwidth]{$1}'],
          ['begin', '\\begin{$1}\n\t$2\n\\end{$1}'],
          ['frac', '\\frac{$1}{$2}'], ['sqrt', '\\sqrt{$1}'],
        ];
        return {
          suggestions: commands.map(([name, snippet]) => ({
            label: name,
            kind: K.Function,
            insertText: snippet ?? `\\${name}`,
            insertTextRules: snippet ? S.InsertAsSnippet : undefined,
            range,
          })),
        };
      }

      return { suggestions: [] };
    },
  });

  // ---- Hover information -------------------------------------------------
  monaco.languages.registerHoverProvider(LATEX_LANG_ID, {
    provideHover: (model, position) => {
      const { index } = useProjectIndexStore.getState();
      if (!index) return null;
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const lineText = model.getLineContent(position.lineNumber);
      const before = lineText.slice(0, word.startColumn - 1);

      // citation hover: key under cursor preceded by \cite…{
      if (/\\(cite|citep|citet|citealp|autocite|textcite|parencite|footcite)[a-zA-Z]*\s*(?:\[[^\]]*\]\s*){0,2}\{[^}]*$/.test(before)) {
        const entry = index.bibEntries.find((b) => b.key === word.word);
        if (!entry) {
          return { contents: [{ value: '⚠ Citation not found in any .bib file' }] };
        }
        const lines = [
          `**@${entry.type}** · ${entry.key}`,
          entry.title ?? '',
          [entry.author, entry.year].filter(Boolean).join(' · '),
        ].filter((s) => s.length > 0);
        return { contents: lines.map((value) => ({ value })) };
      }

      // reference hover: label definition location
      if (/\\(ref|pageref|eqref|autoref)\s*\{[^}]*$/.test(before)) {
        const defs = index.labels.filter((l) => l.key === word.word);
        if (defs.length === 0) {
          return { contents: [{ value: `⚠ No \\label matches '${word.word}'` }] };
        }
        if (defs.length > 1) {
          return { contents: [{ value: `⚠ Label '${word.word}' defined ${defs.length} times` }] };
        }
        return {
          contents: [{ value: `Defined at ${defs[0].file}:${defs[0].line}` }],
        };
      }

      return null;
    },
  });
}

/** Graphics candidates: workspace image/pdf paths from the live index tree. */
function collectGraphics(): { path: string; detail?: string }[] {
  return useProjectIndexStore.getState().index?.graphicsPaths ?? [];
}
