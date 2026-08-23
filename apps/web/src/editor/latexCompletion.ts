import type * as Monaco from 'monaco-editor';
import type { FileNode } from '@latex-studio/shared';
import { api } from '../api/client';

const ENVIRONMENTS = [
  'document', 'itemize', 'enumerate', 'description', 'figure', 'table',
  'tabular', 'tabularx', 'equation', 'align', 'align*', 'gather', 'cases',
  'theorem', 'proof', 'abstract', 'center', 'quote', 'verbatim', 'minipage',
  'thebibliography', 'lstlisting',
];

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf', '.svg'];

interface CompletionContext {
  bibKeys: { key: string; detail: string }[];
  labels: { key: string; detail: string }[];
  graphics: { path: string }[];
}

let ctx: CompletionContext = { bibKeys: [], labels: [], graphics: [] };

export async function refreshCompletionContext(tree: FileNode | null): Promise<void> {
  if (!tree) return;
  try {
    const [bib, labels] = await Promise.all([api.bibKeys(), api.labels()]);
    const graphics: { path: string }[] = [];
    const walk = (node: FileNode) => {
      for (const child of node.children ?? []) {
        if (child.type === 'directory') {
          walk(child);
        } else if (IMAGE_EXTENSIONS.some((e) => child.name.toLowerCase().endsWith(e))) {
          graphics.push({ path: child.path.replace(/\.[^.]+$/, '') });
        }
      }
    };
    walk(tree);
    ctx = {
      bibKeys: bib.keys.map((k) => ({ key: k.key, detail: `${k.type} · ${k.file}:${k.line}` })),
      labels: labels.labels.map((l) => ({ key: l.key, detail: `${l.file}:${l.line}` })),
      graphics,
    };
  } catch {
    /* keep old context */
  }
}

export function registerLatexCompletion(monaco: typeof Monaco): void {
  monaco.languages.registerCompletionItemProvider('latex', {
    triggerCharacters: ['\\', '{'],
    provideCompletionItems: (model, position) => {
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

      // \cite{...}
      if (/\\(cite|citep|citet|autocite|textcite|parencite|footcite)\{[^}]*$/.test(beforeCursor)) {
        return {
          suggestions: ctx.bibKeys.map((b) => ({
            label: b.key,
            kind: K.Constant,
            detail: b.detail,
            insertText: b.key,
            range,
          })),
        };
      }

      // \includegraphics{
      if (/\\includegraphics(\[[^\]]*\])?\{[^}]*$/.test(beforeCursor)) {
        return {
          suggestions: ctx.graphics.map((g) => ({
            label: g.path,
            kind: K.File,
            insertText: g.path,
            range,
          })),
        };
      }

      // \ref / \label
      if (/\\(ref|eqref|pageref|autoref|label)\{[^}]*$/.test(beforeCursor)) {
        return {
          suggestions: ctx.labels.map((l) => ({
            label: l.key,
            kind: K.Variable,
            detail: l.detail,
            insertText: l.key,
            range,
          })),
        };
      }

      // \begin{
      if (/\\begin\{$|\\begin\{[a-zA-Z*]*$/.test(beforeCursor)) {
        const envRange: Monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: Math.max(1, position.column - (beforeCursor.length - beforeCursor.lastIndexOf('{')) + 1),
          endColumn: position.column,
        };
        return {
          suggestions: ENVIRONMENTS.map((env) => ({
            label: env,
            kind: K.Struct,
            insertText: env,
            range: envRange,
          })),
        };
      }

      // backslash commands
      if (/\\[a-zA-Z]*$/.test(beforeCursor)) {
        const commands: [string, string?, string?][] = [
          ['documentclass'], ['usepackage'], ['title'], ['author'], ['date'], ['maketitle'],
          ['section', '\\section{$1}'], ['subsection', '\\subsection{$1}'],
          ['subsubsection', '\\subsubsection{$1}'], ['textbf'], ['textit'], ['emph'],
          ['underline'], ['item'], ['footnote'], ['label'], ['ref'], ['cite'],
          ['includegraphics', '\\includegraphics[width=0.8\\textwidth]{$1}'],
          ['begin', '\\begin{$1}\n\t$2\n\\end{$1}'],
          ['frac', '\\frac{$1}{$2}'], ['sqrt', '\\sqrt{$1}'], ['sum_', '\\sum_{$1} $2'],
          ['int_', '\\int_{$1}^{$2} $3'], ['alpha'], ['beta'], ['gamma'], ['delta'],
          ['lambda'], ['pi'], ['omega'], ['infty'], ['times'], ['cdot'],
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
}
