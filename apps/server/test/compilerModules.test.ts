import { describe, it, expect } from 'vitest';
import { parseSynctexViewOutput } from '../src/compiler/synctexService.js';
import { resolveCompilerChoice, detectTool } from '../src/compiler/detector.js';
import type { LatexEnvironment } from '@latex-studio/shared';

describe('parseSynctexViewOutput', () => {
  it('parses a forward-search hit with page and coordinates', () => {
    const out = [
      'SyncTeX result begin',
      'Output:main.pdf',
      'Input:D:/proj/main.tex',
      'Line:128:0',
      'Hit:1:1',
      '  Page:3;',
      '  x:142.5',
      '  y:610.2',
      'SyncTeX result end',
    ].join('\n');
    const res = parseSynctexViewOutput(out);
    expect(res).not.toBeNull();
    expect(res!.page).toBe(3);
    expect(res!.x).toBeCloseTo(142.5);
    expect(res!.y).toBeCloseTo(610.2);
  });

  it('returns null when there is no hit', () => {
    expect(parseSynctexViewOutput('SyncTeX result begin\nSyncTeX result end')).toBeNull();
    expect(parseSynctexViewOutput('garbage')).toBeNull();
  });
});

function makeEnv(partial: Partial<LatexEnvironment['tools'][number]>[], overrides?: Partial<LatexEnvironment>): LatexEnvironment {
  const tools = partial as LatexEnvironment['tools'];
  return {
    tools,
    distribution: undefined,
    allAvailable: false,
    anyAvailable: true,
    latexmkAvailable: tools.some((t) => t.id === 'latexmk' && t.available && !t.shellWrapperOnly),
    ...overrides,
  };
}

describe('resolveCompilerChoice', () => {
  it('prefers latexmk when available', () => {
    const env = makeEnv([
      { id: 'latexmk', available: true },
      { id: 'xelatex', available: true },
    ]);
    expect(resolveCompilerChoice('auto', env)).toEqual({ compiler: 'latexmk' });
    expect(resolveCompilerChoice('latexmk', env)).toEqual({ compiler: 'latexmk' });
  });

  it('falls back to an engine with a notice when latexmk is missing', () => {
    const env = makeEnv([{ id: 'xelatex', available: true }]);
    const res = resolveCompilerChoice('latexmk', env);
    expect(res?.compiler).toBe('xelatex');
    expect(res?.notice).toContain('direct compiler mode');
  });

  it('falls back for auto too', () => {
    const env = makeEnv([{ id: 'pdflatex', available: true }]);
    expect(resolveCompilerChoice('auto', env)?.compiler).toBe('pdflatex');
  });

  it('returns null when nothing usable exists', () => {
    const env = makeEnv([{ id: 'xelatex', available: true, shellWrapperOnly: true }]);
    expect(resolveCompilerChoice('xelatex', env)).toBeNull();
    expect(resolveCompilerChoice('auto', { ...env, latexmkAvailable: false })).toBeNull();
  });

  it('honors explicit engine choice when available', () => {
    const env = makeEnv([{ id: 'lualatex', available: true }]);
    expect(resolveCompilerChoice('lualatex', env)?.compiler).toBe('lualatex');
    expect(resolveCompilerChoice('pdflatex', env)).toBeNull();
  });
});

describe('detectTool (real environment probe)', () => {
  it('never throws and returns a well-formed record even for missing tools', () => {
    const info = detectTool('biber'); // very likely absent on dev machines
    expect(info.id).toBe('biber');
    expect(typeof info.available).toBe('boolean');
    if (!info.available) {
      expect(info.path).toBeNull();
      expect(info.version).toBeUndefined();
    }
  });
});
