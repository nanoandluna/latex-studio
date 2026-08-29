import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { safeResolve, PathTraversalError } from '../src/utils/paths.js';

/**
 * The jail itself, exercised with every escape shape.
 *
 * The ZIP import test cannot reach these: JSZip normalises entry names before
 * they arrive, so `../x` never gets that far. This file is where the escaping
 * forms are proven rejected.
 */

const ROOT = path.resolve('/tmp/lstudio-workspace');

const HOSTILE = [
  '../escape.tex',
  '../../escape.tex',
  'a/../../../escape.tex',
  '/etc/passwd',
  '/absolute.tex',
  'C:/windows/win.ini',
  'c:\\windows\\win.ini',
  'D:relative.tex',
  '\\\\server\\share\\x.tex', // UNC written with backslashes
  '//server/share/x.tex', // UNC written with forward slashes
  '',
  'null\0byte.tex',
];

describe('safeResolve rejects escapes', () => {
  it('throws for every hostile relative path', () => {
    for (const rel of HOSTILE) {
      expect(() => safeResolve(ROOT, rel), `rel=${JSON.stringify(rel)}`).toThrow(
        PathTraversalError
      );
    }
  });

  it('rejects a bare ".."', () => {
    expect(() => safeResolve(ROOT, '..')).toThrow(PathTraversalError);
  });

  it('accepts ordinary project paths', () => {
    expect(safeResolve(ROOT, 'main.tex')).toBe(path.join(ROOT, 'main.tex'));
    expect(safeResolve(ROOT, 'chapters/intro.tex')).toBe(
      path.join(ROOT, 'chapters', 'intro.tex')
    );
    // a directory-ish name that stays inside is fine
    expect(safeResolve(ROOT, 'chapters/')).toBe(path.join(ROOT, 'chapters'));
  });

  it('accepts a path that merely contains ".." as a name fragment', () => {
    expect(safeResolve(ROOT, 'chapters/..notes.tex')).toBe(
      path.join(ROOT, 'chapters', '..notes.tex')
    );
    expect(safeResolve(ROOT, 'a/b..c/d.tex')).toBe(path.join(ROOT, 'a', 'b..c', 'd.tex'));
  });

  it('normalises redundant separators without leaving the root', () => {
    expect(safeResolve(ROOT, 'chapters//intro.tex')).toBe(
      path.join(ROOT, 'chapters', 'intro.tex')
    );
  });

  it('never returns a path outside the root for traversal attempts', () => {
    for (const rel of HOSTILE) {
      let resolved: string | null = null;
      try {
        resolved = safeResolve(ROOT, rel);
      } catch {
        resolved = null;
      }
      if (resolved === null) continue;
      const rel2 = path.relative(ROOT, resolved);
      expect(rel2.startsWith('..'), `rel=${rel} → ${resolved}`).toBe(false);
      expect(path.isAbsolute(rel2), `rel=${rel} → ${resolved}`).toBe(false);
    }
  });
});
