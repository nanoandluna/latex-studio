import { describe, it, expect } from 'vitest';
import { analyzeTextStatistics } from '../src/textStats.js';

describe('analyzeTextStatistics', () => {
  it('counts CJK characters and Latin words separately', () => {
    const r = analyzeTextStatistics('这是一个 radar system');
    // 这是一个 = 4 CJK chars
    expect(r.cjkCharacters).toBe(4);
    expect(r.latinWords).toBe(2); // radar, system
  });

  it('counts numeric tokens separately', () => {
    const r = analyzeTextStatistics('实验 123 完成 456');
    expect(r.numericTokens).toBe(2);
    expect(r.cjkCharacters).toBe(4); // 实验完成
  });

  it('excludes LaTeX commands and their metadata arguments', () => {
    const r = analyzeTextStatistics('\\section{Introduction}\n这是正文。\\cite{smith2025}');
    expect(r.latinWords).toBeGreaterThanOrEqual(1);
    expect(r.cjkCharacters).toBe(4); // 这是正文
  });

  it('keeps text-producing command inner content', () => {
    const r = analyzeTextStatistics('\\textbf{bold words} here');
    expect(r.latinWords).toBeGreaterThanOrEqual(3);
  });

  it('excludes math environment bodies from word counts but counts equations', () => {
    const r = analyzeTextStatistics(
      'Before \\begin{equation}\\label{eq:x} E=mc^2 \\end{equation} after'
    );
    expect(r.equations).toBe(1);
  });

  it('strips comments before counting', () => {
    const r = analyzeTextStatistics('real text % comment words here');
    expect(r.latinWords).toBeGreaterThanOrEqual(2);
  });
});
