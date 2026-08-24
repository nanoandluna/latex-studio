import { describe, it, expect } from 'vitest';
import {
  parseStructure,
  parseLabelOccurrences,
  parseReferenceOccurrences,
  parseCitationOccurrences,
  stripComments,
  findClosingBrace,
  parseIncludes,
  parseGraphics,
  parsePackages,
  parseBibDirectives,
  parseEnvironments,
  parseBibEntries,
  parseTexDocument,
  assembleProjectIndex,
} from '../src/index.js';

describe('stripComments / findClosingBrace', () => {
  it('strips % comments but keeps escaped \\%', () => {
    expect(stripComments('hello % note')).toBe('hello ');
    expect(stripComments('50\\% off')).toBe('50\\% off');
  });

  it('handles nested braces', () => {
    expect(findClosingBrace('{a{b}c}', 0)).toBe(6);
    expect(findClosingBrace('{a', 0)).toBe(-1);
  });
});

describe('parseStructure', () => {
  it('parses sectioning with levels, lines and columns', () => {
    const tex = [
      '\\documentclass{article}',
      '\\section{Intro}',
      'text',
      '\\subsection{Background}',
      '\\section*{Starred}',
      '% \\section{commented}',
    ].join('\n');
    const s = parseStructure(tex, 'main.tex');
    expect(s).toHaveLength(3);
    expect(s[0]).toMatchObject({ title: 'Intro', level: 2, file: 'main.tex', line: 2 });
    expect(s[1]).toMatchObject({ title: 'Background', level: 3, line: 4 });
    expect(s[2].level).toBe(2);
  });

  it('supports chapter/part/paragraph and nested braces in title', () => {
    const tex = '\\chapter{The {Big} Method}\n\\paragraph{Note}';
    const s = parseStructure(tex, 'c.tex');
    expect(s.map((x) => x.title)).toEqual(['The {Big} Method', 'Note']);
    expect(s[0].level).toBe(1);
  });
});

describe('label/reference/citation occurrences', () => {
  const tex = [
    '\\label{sec:intro}',
    'see \\ref{fig:a} and \\pageref{sec:intro}, \\eqref{eq:1}',
    '\\cite{smith2025,doe2024}',
    '\\citep[see][p.~3]{one2020}',
    '% \\ref{commented}',
  ].join('\n');

  it('expands labels', () => {
    expect(parseLabelOccurrences(tex, 'm.tex')).toHaveLength(1);
  });

  it('expands references with kinds and ignores comments', () => {
    const refs = parseReferenceOccurrences(tex, 'm.tex');
    expect(refs.map((r) => r.key).sort()).toEqual(['eq:1', 'fig:a', 'sec:intro']);
    expect(refs.find((r) => r.key === 'eq:1')!.kind).toBe('eqref');
  });

  it('expands multi-key citations', () => {
    const cites = parseCitationOccurrences(tex, 'm.tex');
    expect(cites.map((c) => c.key).sort()).toEqual(['doe2024', 'one2020', 'smith2025']);
  });
});

describe('includes / graphics / packages / bib directives', () => {
  const tex = [
    '\\input{sections/intro}',
    '\\include{sections/method.tex}',
    '\\includegraphics[width=0.5\\textwidth]{figures/plot.png}',
    '\\usepackage{amsmath,graphicx}',
    '\\usepackage[backend=biber]{biblatex}',
    '\\bibliography{refs}',
    '\\addbibresource{refs.bib}',
  ].join('\n');

  it('parses includes', () => {
    const inc = parseIncludes(tex, 'main.tex');
    expect(inc.map((i) => i.targetRaw)).toEqual(['sections/intro', 'sections/method.tex', ]);
    expect(inc[0].kind).toBe('input');
    expect(inc[1].kind).toBe('include');
  });

  it('parses graphics and packages', () => {
    expect(parseGraphics(tex, 'm.tex')[0].file).toBe('figures/plot.png');
    const pkgs = parsePackages(tex, 'm.tex');
    expect(pkgs.map((p) => p.name)).toEqual(['amsmath', 'graphicx', 'biblatex']);
    expect(pkgs[2].options).toBe('backend=biber');
  });

  it('parses bibliography directives', () => {
    const d = parseBibDirectives(tex, 'm.tex');
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ kind: 'bibtex', targets: ['refs'] });
    expect(d[1]).toMatchObject({ kind: 'biber', targets: ['refs.bib'] });
  });
});

describe('parseEnvironments', () => {
  it('captures figure/table captions+labels and labeled equations', () => {
    const tex = [
      '\\begin{figure}[h]',
      '  \\centering',
      '  \\includegraphics{f.png}',
      '  \\caption{Architecture}\\label{fig:arch}',
      '\\end{figure}',
      '\\begin{table}',
      '  \\caption{Results}\\label{tab:res}',
      '\\end{table}',
      '\\begin{equation}',
      '  E = mc^2 \\label{eq:e}',
      '\\end{equation}',
      '\\begin{equation}',
      '  x=1',
      '\\end{equation}',
    ].join('\n');
    const envs = parseEnvironments(tex, 'm.tex');
    expect(envs.figures[0]).toMatchObject({ key: 'fig:arch', caption: 'Architecture' });
    expect(envs.tables[0]).toMatchObject({ key: 'tab:res', caption: 'Results' });
    expect(envs.equations).toEqual([{ key: 'eq:e', file: 'm.tex', line: 9 }]);
  });
});

describe('parseBibEntries hover fields', () => {
  it('extracts author/title/year across braces', () => {
    const bib = '@article{smith2025,\n  author = {Smith, Jane and Doe, J.},\n  title = {Deep {Learning} for Radar},\n  year = {2025},\n}';
    const e = parseBibEntries(bib, 'r.bib')[0];
    expect(e.author).toBe('Smith, Jane and Doe, J.');
    expect(e.title).toBe('Deep Learning for Radar');
    expect(e.year).toBe('2025');
  });
});

describe('assembleProjectIndex (multi-file)', () => {
  const main = parseTexDocument({
    path: 'main.tex',
    content: [
      '\\documentclass{article}',
      '\\section{Introduction}\\label{sec:intro}',
      '\\cite{smith2025}',
      '\\ref{sec:method}',
      '\\ref{nope}',
      '\\input{sections/method}',
      '\\bibliography{refs}',
    ].join('\n'),
  });
  const method = parseTexDocument({
    path: 'sections/method.tex',
    content: ['\\section{Method}\\label{sec:method}', '\\label{sec:method}'].join('\n'),
  });
  const bib = [{ file: 'refs.bib', entries: parseBibEntries('@article{smith2025, title={T}}', 'refs.bib') }];

  const index = assembleProjectIndex([main, method], bib, 'main.tex');

  it('aggregates sections across files', () => {
    expect(index.sections.map((s) => `${s.file}:${s.title}`)).toEqual([
      'main.tex:Introduction',
      'sections/method.tex:Method',
    ]);
  });

  it('builds the include graph', () => {
    expect(index.includes).toEqual([
      { from: 'main.tex', to: 'sections/method.tex', kind: 'input', line: 6 },
    ]);
    expect(index.files).toContain('sections/method.tex');
  });

  it('flags undefined reference, duplicate label; no false citation error', () => {
    const codes = index.diagnostics.map((d) => d.code);
    expect(codes).toContain('UNDEFINED_REFERENCE'); // \ref{nope}
    expect(codes).toContain('DUPLICATE_LABEL'); // sec:method ×2
    expect(index.diagnostics.filter((d) => d.code === 'UNDEFINED_CITATION')).toHaveLength(0);
    const dup = index.diagnostics.find((d) => d.code === 'DUPLICATE_LABEL')!;
    expect(dup).toMatchObject({ file: 'sections/method.tex', line: 2, key: 'sec:method' });
  });
});
