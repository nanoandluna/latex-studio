import type { TextStatistics } from '@latex-studio/shared';

/**
 * V0.4 Paper Statistics — CJK-aware dual-track text counting.
 *
 * Rules:
 *  - comments stripped first
 *  - LaTeX commands removed, BUT brace content of text-producing commands
 *    (\section/\chapter/\textbf/\emph/\title…) is KEPT as prose
 *  - \label/\cite/\ref/\includegraphics argument bodies are excluded entirely
 *  - math environments ($$…, \(…\), equation/align/gather…) counted separately
 *    and NOT added to visible word counts
 */

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_WORD_RE = /[A-Za-z]+/g;
const NUMBER_RE = /\d+/g;

/** Index just past the closing delimiter that matches the one at `start`. */
function skipBalanced(s: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '\\') {
      i++; // escaped delimiter does not affect nesting
      continue;
    }
    if (s[i] === open) depth++;
    else if (s[i] === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return s.length;
}

/**
 * Drop a command together with `argCount` balanced brace groups.
 *
 * A regex cannot do this: `\{[^{}]*\}` stops at the first closing brace, so a
 * macro body containing any brace — `\newcommand{\foo}{\textbf{hi there}}` —
 * would be only partially removed and its text would be counted as prose.
 * Definitions are metadata, never prose, so the whole thing has to go.
 */
function stripCommandsWithArgs(s: string, names: string[], argCount: number): string {
  const re = new RegExp(`\\\\(?:${names.join('|')})\\*?`, 'g');
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(s)) !== null) {
    let i = m.index + m[0].length;
    if (i <= last) continue; // overlapping match; already consumed

    // optional [..] argument
    let j = i;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (s[j] === '[') i = skipBalanced(s, j, '[', ']');

    for (let a = 0; a < argCount; a++) {
      let k = i;
      while (k < s.length && /\s/.test(s[k])) k++;
      if (s[k] !== '{') break;
      i = skipBalanced(s, k, '{', '}');
    }

    out += s.slice(last, m.index) + ' ';
    last = i;
    re.lastIndex = i;
  }
  return out + s.slice(last);
}

/** Definitions: two brace groups (name + body), the body being prose-free. */
const MACRO_DEF_NAMES = [
  'newcommand',
  'renewcommand',
  'providecommand',
  'DeclareMathOperator',
  'newenvironment',
  'renewenvironment',
];

/** Strip comments while preserving escaped \%. */
function stripLineComments(content: string): string {
  return content
    .split('\n')
    .map((l) => {
      let out = '';
      for (let i = 0; i < l.length; i++) {
        if (l[i] === '\\' && i + 1 < l.length) {
          out += l[i] + l[i + 1];
          i++;
          continue;
        }
        if (l[i] === '%') break;
        out += l[i];
      }
      return out;
    })
    .join('\n');
}

/** Commands whose arguments are pure metadata → remove command AND braces. */
const EXCLUDE_ARG_RE =
  /\\(?:label|cite|citep|citet|citealp|autocite|textcite|parencite|footcite|ref|eqref|pageref|autoref|includegraphics|bibliography|addbibresource|input|include|usepackage|documentclass|bibliographystyle|setlength|hypersetup)\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g;

/** \def\name{body} — the name is a control sequence, not a brace group. */
const TEX_DEF_RE = /\\def\s*\\[a-zA-Z@]+\s*(?:\{[^{}]*\})?/g;

export interface TextStatsResult extends TextStatistics {
  equations: number;
}

export function analyzeTextStatistics(raw: string): TextStatsResult {
  let s = stripLineComments(raw);

  const sourceCharacters = [...raw].length;

  // remove preamble
  const docStart = s.indexOf('\\begin{document}');
  if (docStart !== -1) s = s.slice(docStart);

  // exclude math environments from word counting
  let equations = 0;
  const mathEnvRe = /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|displaymath)\}[\s\S]*?\\end\{\1\}/g;
  s = s.replace(mathEnvRe, () => {
    equations++;
    return ' ';
  });
  const displayMathRe = /\$\$[\s\S]*?\$\$/g;
  s = s.replace(displayMathRe, () => {
    equations++;
    return ' ';
  });
  // inline math contributes no words; it is not counted as an equation
  // (equation tallies come from the Project Graph's environment nodes)
  const inlineMathRe = /(?<!\\)\$[^$\n]+?(?<!\\)\$/g;
  s = s.replace(inlineMathRe, ' ');

  // remove metadata commands, then definitions (whose bodies are never prose)
  s = s.replace(EXCLUDE_ARG_RE, ' ');
  s = stripCommandsWithArgs(s, MACRO_DEF_NAMES, 2);
  s = s.replace(TEX_DEF_RE, ' ');

  // keep text-producing command inner text (section headings, text formatting)
  s = s.replace(/\\(?:section|subsection|subsubsection|chapter|part|paragraph|textbf|textit|emph|underline|text|mbox)\*?\s*(?:\[[^\]]*\])?\{/g, '{');

  // remove remaining commands
  s = s.replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?(\{[^{}]*\})?/g, ' ');
  // remove remaining braces/structure chars
  s = s.replace(/[{}~&$#^_]/g, ' ');

  // count CJK characters
  const cjkCharacters = (s.match(CJK_RE) ?? []).length;

  // count Latin words
  const latinWords = (s.match(LATIN_WORD_RE) ?? []).length;

  // count numeric tokens
  const numericTokens = (s.match(NUMBER_RE) ?? []).length;

  // whitespace-delimited tokens
  const whitespaceTokens = s.split(/\s+/).filter((t) => t.trim()).length;

  // visible characters = non-whitespace
  const visibleCharacters = s.replace(/\s/g, '').length;

  return {
    cjkCharacters,
    latinWords,
    numericTokens,
    whitespaceTokens,
    visibleCharacters,
    sourceCharacters,
    estimatedWords: cjkCharacters + latinWords,
    equations,
  };
}
