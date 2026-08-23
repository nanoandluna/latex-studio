import type * as Monaco from 'monaco-editor';

export const LATEX_LANG_ID = 'latex';

export function registerLatexLanguage(monaco: typeof Monaco): void {
  if (monaco.languages.getLanguages().some((l) => l.id === LATEX_LANG_ID)) return;

  monaco.languages.register({ id: LATEX_LANG_ID, extensions: ['.tex', '.sty', '.cls'], aliases: ['LaTeX', 'latex'] });

  monaco.languages.setMonarchTokensProvider(LATEX_LANG_ID, {
    defaultToken: '',
    tokenPostfix: '.latex',
    brackets: [
      { open: '{', close: '}', token: 'delimiter.curly' },
      { open: '[', close: ']', token: 'delimiter.square' },
      { open: '(', close: ')', token: 'delimiter.parenthesis' },
    ],
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/\\begin\{/, { token: 'keyword', next: '@environment' }],
        [/\\end\{/, { token: 'keyword', next: '@environment' }],
        [/\\[a-zA-Z@]+\*?/, 'keyword'],
        [/\\\$/, ''],
        [/\$/, { token: 'string', next: '@mathInline' }],
        [/\$\$/, { token: 'string', next: '@mathDisplay' }],
        [/\\?\[[a-zA-Z0-9.]+\]/, 'annotation'],
        [/[{}]/, 'delimiter.curly'],
        [/[[\]]/, 'delimiter.square'],
        [/[&]/, 'operator'],
        [/[~^_]/, 'operator'],
      ],
      environment: [
        [/[a-zA-Z*]+/, 'type.identifier'],
        [/\}/, { token: 'keyword', next: '@pop' }],
      ],
      mathInline: [
        [/\\\$/, 'string'],
        [/\$/, { token: 'string', next: '@pop' }],
        [/./, 'string'],
      ],
      mathDisplay: [
        [/\$\$/, { token: 'string', next: '@pop' }],
        [/./, 'string'],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration(LATEX_LANG_ID, {
    comments: { lineComment: '%' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '$', close: '$', notIn: ['string'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '$', close: '$' },
    ],
    folding: {
      markers: {
        start: /^\s*%region\b/,
        end: /^\s*%endregion\b/,
      },
    },
    onEnterRules: [
      {
        beforeText: /^\s*\\item\s*/,
        action: { indentAction: monaco.languages.IndentAction.IndentOutdent },
      },
    ],
  });

  monaco.editor.defineTheme('latex-studio-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c678dd' },
      { token: 'string', foreground: '98c379' },
      { token: 'type.identifier', foreground: 'e5c07b' },
    ],
    colors: {
      'editor.background': '#18181b',
    },
  });
}
