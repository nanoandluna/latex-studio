import { describe, it, expect } from 'vitest';
import { analyzeTextStatistics } from '../src/textStats.js';

/**
 * Assertions here are exact on purpose. A `toBeGreaterThanOrEqual` expectation
 * cannot tell a working implementation from a broken one — e.g. comment
 * stripping yields 2 words and skipping it yields 5, so only `toBe(2)` proves
 * the rule ran. Keep it that way when adding cases.
 */
describe('analyzeTextStatistics', () => {
  it('counts CJK characters and Latin words separately', () => {
    const r = analyzeTextStatistics('这是一个 radar system');
    expect(r.cjkCharacters).toBe(4);
    expect(r.latinWords).toBe(2);
    expect(r.estimatedWords).toBe(6);
  });

  it('counts numeric tokens separately from CJK and Latin', () => {
    const r = analyzeTextStatistics('实验 123 完成 456');
    expect(r.numericTokens).toBe(2);
    expect(r.cjkCharacters).toBe(4);
    expect(r.latinWords).toBe(0);
  });

  it('keeps section title text but drops metadata command arguments', () => {
    const r = analyzeTextStatistics('\\section{Introduction}\n这是正文。\\cite{smith2025}');
    expect(r.cjkCharacters).toBe(4);
    // "Introduction" is prose; "smith2025" inside \cite is metadata
    expect(r.latinWords).toBe(1);
  });

  it('keeps the inner text of formatting commands', () => {
    const r = analyzeTextStatistics('\\textbf{bold words} here');
    expect(r.latinWords).toBe(3);
  });

  it('excludes math environment bodies from word counts but counts equations', () => {
    const r = analyzeTextStatistics(
      'Before \\begin{equation}\\label{eq:x} E=mc^2 \\end{equation} after'
    );
    expect(r.equations).toBe(1);
    // only Before/after; E, mc and the label must not leak into the total
    expect(r.latinWords).toBe(2);
  });

  it('strips comments before counting', () => {
    const r = analyzeTextStatistics('real text % comment words here');
    expect(r.latinWords).toBe(2);
  });

  it('preserves an escaped percent sign instead of treating it as a comment', () => {
    // treating \% as a comment would drop "real text" and leave only "growth"
    const r = analyzeTextStatistics('growth 50\\% real text');
    expect(r.latinWords).toBe(3);
    expect(r.numericTokens).toBe(1);
  });

  it('excludes inline math from word counts without counting it as an equation', () => {
    const r = analyzeTextStatistics('The value $x^2 + y$ matters here');
    expect(r.latinWords).toBe(4);
    expect(r.equations).toBe(0);
  });

  it('ignores the preamble', () => {
    const r = analyzeTextStatistics(
      '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n正文一段\n\\end{document}'
    );
    expect(r.cjkCharacters).toBe(4);
    // documentclass/usepackage/begin/end contribute no words
    expect(r.latinWords).toBe(0);
  });

  // ---- exclusions that must hold individually ----
  // Each of these fails if the corresponding rule is removed from the analyzer.

  it('excludes a macro definition body, including nested braces', () => {
    const simple = analyzeTextStatistics('\\newcommand{\\foo}{hello world}');
    expect(simple.latinWords).toBe(0);

    const nested = analyzeTextStatistics('\\newcommand{\\foo}{\\textbf{hello world}}');
    expect(nested.latinWords).toBe(0);

    const renewed = analyzeTextStatistics('\\renewcommand{\\bar}{some text}');
    expect(renewed.latinWords).toBe(0);
  });

  it('excludes \\def bodies', () => {
    const r = analyzeTextStatistics('\\def\\greeting{hidden text}');
    expect(r.latinWords).toBe(0);
  });

  it('excludes file paths passed to input, include and graphics', () => {
    const r = analyzeTextStatistics(
      '\\input{chapters/intro}\n\\include{backmatter}\n\\includegraphics{figures/plot}'
    );
    // "chapters", "intro", "backmatter", "figures", "plot" are not prose
    expect(r.latinWords).toBe(0);
  });

  it('keeps prose that merely sits next to an excluded command', () => {
    const r = analyzeTextStatistics('See \\ref{sec:intro} and \\cite{smith2020} for detail');
    expect(r.latinWords).toBe(4); // See and for detail
  });
});
