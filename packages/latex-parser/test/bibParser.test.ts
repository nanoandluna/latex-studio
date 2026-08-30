import { describe, it, expect } from 'vitest';
import { parseBibKeys, parseBibEntries, parseLabels } from '../src/index.js';

const bib = `% comment @article{fake, ...
@article{smith2025,
  author = {Smith, J.},
  title = {Something},
  year = {2025},
}

@inproceedings{doe2024,
  title = {Other},
}

@string{foo = "bar"}
`;

describe('parseBibKeys', () => {
  it('extracts citation keys with line numbers', () => {
    const keys = parseBibKeys(bib);
    expect(keys.map((k) => k.key)).toEqual(['smith2025', 'doe2024']);
    expect(keys[0].type).toBe('article');
    expect(keys[1].line).toBe(8);
  });
});

describe('parseBibEntries · BibLaTeX edge cases (V0.5.1)', () => {
  it('ignores entries nested inside @comment bodies', () => {
    const content = [
      '@comment{',
      '  @article{ghostComment, title={not real}}',
      '}',
      '@article{real, title={Real}}',
    ].join('\n');
    const entries = parseBibEntries(content, 'x.bib');
    expect(entries.map((e) => e.key)).toEqual(['real']);
  });

  it('does not create phantom entries from @-looking text inside fields', () => {
    const content = '@article{tricky, title = {A survey of @inproceedings{fake2020, stuff}}}';
    const entries = parseBibEntries(content, 'x.bib');
    // the title text legitimately contains "@" — the point is that no second
    // entry is created from it
    expect(entries.map((e) => e.key)).toEqual(['tricky']);
  });

  it('marks duplicate keys on the surviving entry', () => {
    const content = '@misc{dup, title={A}}\n@misc{dup, title={B}}';
    const entries = parseBibEntries(content, 'x.bib');
    expect(entries).toHaveLength(1);
    expect(entries[0].duplicate).toBe(true);
    expect(entries[0].title).toBe('A');
  });

  it('matches fields on a word start and strips nested braces', () => {
    const content = [
      '@misc{edge,',
      '  years = {2019-2021},',
      '  year = {2020},',
      '  title = {Deep {Learning} for  Radar},',
      '}',
    ].join('\n');
    const entries = parseBibEntries(content, 'x.bib');
    expect(entries[0].year).toBe('2020'); // not "2019-2021" via the "years" field
    expect(entries[0].title).toBe('Deep Learning for Radar');
  });
});

describe('parseLabels', () => {
  it('extracts label keys', () => {
    const tex = '\\section{A}\\label{sec:intro}\ntext\\label{fig:plot}\n\\label{sec:intro}';
    const labels = parseLabels(tex);
    expect(labels.map((l) => l.key)).toEqual(['sec:intro', 'fig:plot']);
    expect(labels[1].line).toBe(2);
  });
});
