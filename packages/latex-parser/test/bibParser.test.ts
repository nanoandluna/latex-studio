import { describe, it, expect } from 'vitest';
import { parseBibKeys, parseLabels } from '../src/index.js';

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

describe('parseLabels', () => {
  it('extracts label keys', () => {
    const tex = '\\section{A}\\label{sec:intro}\ntext\\label{fig:plot}\n\\label{sec:intro}';
    const labels = parseLabels(tex);
    expect(labels.map((l) => l.key)).toEqual(['sec:intro', 'fig:plot']);
    expect(labels[1].line).toBe(2);
  });
});
