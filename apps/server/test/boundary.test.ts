import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { isIgnoredWorkspacePath } from '../src/services/fileWatcher.js';

/**
 * V0.3 Filesystem Boundary tests.
 *
 * The workspace jail must hold for:
 *   ../ traversal · absolute paths · drive letters · UNC paths ·
 *   symlinks (POSIX) · junctions/reparse points (Windows)
 *
 * A link INSIDE the workspace pointing OUTSIDE must never contribute nodes
 * to the graph, and /api/file/raw must refuse to serve through it when the
 * resolved target leaves the jail.
 */

let tmpRoot: string;
let outsideDir: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-bnd-'));
  outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-outside-'));

  // legit project files
  await fs.writeFile(
    path.join(tmpRoot, 'main.tex'),
    '\\documentclass{article}\n\\input{chapters/intro}\n\\begin{document}x\\end{document}'
  );
  await fs.mkdir(path.join(tmpRoot, 'chapters'));
  await fs.writeFile(
    path.join(tmpRoot, 'chapters', 'intro.tex'),
    '\\section{Intro}\\label{sec:intro}\n\\ref{ghost}'
  );

  // secret outside the workspace
  await fs.writeFile(path.join(outsideDir, 'secret.tex'), '\\section{SECRET}');
  await fs.writeFile(path.join(outsideDir, 'secret.png'), Buffer.from([0x89, 0x50]));

  app = await createApp();
  await app.inject({
    method: 'POST',
    url: '/api/workspace/open',
    payload: { path: tmpRoot },
  });
});

afterAll(async () => {
  await app?.close();
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  await fs.rm(outsideDir, { recursive: true, force: true }).catch(() => {});
});

/** Create a link kind if the platform/filesystem supports it. */
async function makeLink(linkPath: string, target: string, kind: 'symlink' | 'junction'): Promise<boolean> {
  try {
    await fs.symlink(target, linkPath, kind === 'junction' ? 'junction' : undefined);
    return true;
  } catch {
    return false;
  }
}

describe('watcher path filter', () => {
  it('ignores build artifacts by extension', () => {
    expect(isIgnoredWorkspacePath('.build/main.aux')).toBe(true);
    expect(isIgnoredWorkspacePath('main.log')).toBe(true);
    expect(isIgnoredWorkspacePath('deep/nested/x.fls')).toBe(true);
    expect(isIgnoredWorkspacePath('out.bbl')).toBe(true);
  });

  it('ignores metadata dirs and hidden entries but keeps sources', () => {
    expect(isIgnoredWorkspacePath('.latex-studio/cache.json')).toBe(true);
    expect(isIgnoredWorkspacePath('.git/config')).toBe(true);
    expect(isIgnoredWorkspacePath('node_modules/x/index.js')).toBe(true);
    expect(isIgnoredWorkspacePath('chapters/intro.tex')).toBe(false);
    expect(isIgnoredWorkspacePath('refs.bib')).toBe(false);
  });
});

describe('filesystem boundaries via API', () => {
  it.each([
    ['../secret.tex'],
    ['..\\secret.tex'],
    [os.homedir() + '\\\\secret.tex'],
    ['C:/secret.tex'],
    ['\\\\server\\share\\secret.tex'],
  ])('file/raw refuses %j', async (p) => {
    const res = await app.inject({ method: 'GET', url: `/api/file/raw?path=${encodeURIComponent(p)}` });
    expect([403, 404, 415]).toContain(res.statusCode);
    if (res.statusCode === 403) {
      expect(res.json().error.code).toBe('PATH_FORBIDDEN');
    }
  });

  it('index update refuses escaping buffer paths', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/index/update',
      payload: { path: path.join(outsideDir, 'secret.tex'), content: '\\section{EVIL}' },
    });
    expect(res.statusCode).toBe(200); // endpoint responds…
    const idx = res.json();
    // …but the evil file must NOT appear anywhere in the index
    expect(JSON.stringify(idx)).not.toContain('EVIL');
    expect(idx.files ?? []).not.toContain(expect.stringContaining('outside'));
  });
});

// Windows junctions / reparse points
describe.skipIf(process.platform !== 'win32')('Windows junction boundary', () => {
  let junctionCreated = false;

  beforeAll(async () => {
    junctionCreated = await makeLink(
      path.join(tmpRoot, 'external'),
      outsideDir,
      'junction'
    );
  });

  it('walker does not index files reached through a junction', async () => {
    if (!junctionCreated) return; // environment lacks privilege
    const res = await app.inject({ method: 'POST', url: '/api/index/refresh' });
    const body = res.json();
    expect(body.filesParsed).toBe(2); // main.tex + chapters/intro.tex only
    expect(JSON.stringify(body.index)).not.toContain('SECRET');
  });

  it('file/raw refuses to serve through the junction', async () => {
    if (!junctionCreated) return;
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/raw?path=${encodeURIComponent('external/secret.png')}`,
    });
    // Either the jail rejects the resolved absolute path (403/404) or the
    // walk never exposed the path — anything except serving the bytes.
    expect([403, 404]).toContain(res.statusCode);
  });
});

// POSIX symlinks (and Windows dev-mode symlinks) — best effort
describe('symlink escape', () => {
  let created = false;
  let linkPath = '';

  beforeAll(async () => {
    linkPath = path.join(tmpRoot, 'leak');
    try {
      await fs.symlink(outsideDir, linkPath, 'dir');
      created = true;
    } catch {
      created = false;
    }
  });

  it.skipIf(!created)('does not follow directory symlinks out of the jail', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/index/refresh' });
    const body = res.json();
    expect(JSON.stringify(body.index)).not.toContain('SECRET');
    // files count stays at the two real sources
    expect(body.filesParsed).toBe(2);
  });
});
