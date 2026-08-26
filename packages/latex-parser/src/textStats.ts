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
  /\\(?:label|cite|citep|citet|citealp|autocite|textcite|parencite|footcite|ref|eqref|pageref|autoref|label|includegraphics|bibliography|addbibresource|input|include|usepackage|documentclass|bibliographystyle|newcommand|renewcommand|def)\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g;

/** Text-producing commands → keep inner text, drop the command itself. */
const KEEP_INNER_RE = /\\(textbf|textit|emph|underline|text|textrm|textsf|mbox|hline)\s*/g;

export interface TextStatsResult extends TextStatistics {
  equations: number;
}

export function analyzeTextStatistics(raw: string): TextStatsResult {
  // strip comments
  let s = raw
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

  let sourceCharacters = 0;
  for (const ch of raw) sourceCharacters++;

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

  // remove metadata commands
  s = s.replace(EXCLUDE_ARG_RE, ' ');

  // keep text-producing command inner text (section headings, text formatting)
  s = s.replace(/\\(?:section|subsection|subsubsection|chapter|part|paragraph|textbf|textit|emph|underline|text|mbox)\*?\s*(?:\[[^\]]*\])?\{/g, '{');

  // preserve section/chapter title text before generic command removal
  s = s.replace(/\\\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\\\\?(?:\\[[^\\\\]]*\\\\])?/g, '');
  // remove remaining commands
  s = s.replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?(\{[^{}]*\})?/g, ' ');
  // remove remaining braces/structure chars
  s = s.replace(/[{}~&$#^_]/g, ' ');

  // count CJK characters
  const cjkMatches = s.match(new RegExp('[\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]', 'g')) ?? [];
  const cjkCharacters = cjkMatches.length;

  // count Latin words
  const latinWords = (s.match(/[A-Za-z]+/g) ?? []).length;

  // count numeric tokens
  const numericTokens = (s.match(/\d+/g) ?? []).length;

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
