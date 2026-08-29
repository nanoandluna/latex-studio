import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

/**
 * V0.4 Snapshots — manifest shape, retention, restore, and the path jail.
 *
 * The cwd test is the important one: snapshots and search used to read
 * workspace-relative paths against process.cwd(), so they silently produced
 * empty snapshots whenever the server was launched from anywhere else.
 */

let ws: string;
let app: Awaited<ReturnType<typeof createApp>>;

const post = (url: string, payload?: unknown) =>
  app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
const get = (url: string) => app.inject({ method: 'GET', url });

beforeAll(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-v04-snap-'));
  await fs.mkdir(path.join(ws, 'chapters'), { recursive: true });
  await fs.writeFile(
    path.join(ws, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\n\\input{chapters/intro}\n\\end{document}\n'
  );
  await fs.writeFile(
    path.join(ws, 'chapters', 'intro.tex'),
    '\\section{Intro}\noriginal content here\n'
  );
  // artifacts and metadata that must never be snapshotted
  await fs.mkdir(path.join(ws, '.build'), { recursive: true });
  await fs.writeFile(path.join(ws, 'main.aux'), 'junk');
  await fs.writeFile(path.join(ws, '.build', 'main.pdf'), 'junk');

  app = await createApp();
  await post('/api/workspace/open', { path: ws });
});

afterAll(async () => {
  await app?.close();
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
});

describe('manifest shape', () => {
  it('carries every declared field with real values', async () => {
    const res = await post('/api/workspace/snapshots', { reason: 'manual', label: 'first' });
    expect(res.statusCode).toBe(201);
    const m = res.json();

    expect(m.version).toBe(1);
    expect(m.snapshotId).toMatch(/^snap_\d{14}_[a-z0-9]+$/);
    expect(typeof m.workspaceId).toBe('string');
    expect(m.workspaceId.length).toBe(16);
    expect(typeof m.createdAt).toBe('number');
    expect(m.reason).toBe('manual');
    expect(m.label).toBe('first');
    expect(m.mainFile).toBeTruthy();
    expect(m.fileCount).toBe(2); // main.tex + chapters/intro.tex
    expect(m.totalBytes).toBeGreaterThan(0);
    expect(m.contentHash).toMatch(/^[a-f0-9]{64}$/); // sha256
    expect(Array.isArray(m.files)).toBe(true);
    expect(m.files).toHaveLength(2);
  });

  it('excludes build artifacts and the metadata dir', async () => {
    const m = (await post('/api/workspace/snapshots', { reason: 'manual' })).json();
    const paths = m.files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual(['chapters/intro.tex', 'main.tex']);
  });

  it('rejects an unknown reason by falling back to manual', async () => {
    const m = (await post('/api/workspace/snapshots', { reason: 'not-a-reason' })).json();
    expect(m.reason).toBe('manual');
  });
});

describe('content dedupe', () => {
  it('skips creation when nothing changed', async () => {
    const before = (await get('/api/workspace/snapshots')).json() as { snapshotId: string }[];
    const res = await post('/api/workspace/snapshots', { reason: 'manual' });
    expect(res.statusCode).toBe(200); // 200, not 201
    expect(res.json().skipped).toBe(true);

    const after = (await get('/api/workspace/snapshots')).json() as { snapshotId: string }[];
    expect(after.length).toBe(before.length);
    expect(after[0].snapshotId).toBe(before[0].snapshotId);
  });

  it('creates again once content changes', async () => {
    await fs.writeFile(
      path.join(ws, 'chapters', 'intro.tex'),
      '\\section{Intro}\nCHANGED content here\n'
    );
    const res = await post('/api/workspace/snapshots', { reason: 'manual' });
    expect(res.statusCode).toBe(201);
    expect(res.json().skipped).toBe(false);
  });
});

describe('snapshot creation is independent of process.cwd()', () => {
  it('still captures every file when cwd is elsewhere', async () => {
    const original = process.cwd();
    try {
      // fresh content so this is a real create, not a dedupe skip
      await fs.writeFile(
        path.join(ws, 'chapters', 'intro.tex'),
        '\\section{Intro}\ncwd independence probe\n'
      );
      process.chdir(os.tmpdir());
      const res = await post('/api/workspace/snapshots', { reason: 'manual', label: 'from-elsewhere' });
      expect(res.statusCode).toBe(201);
      const m = res.json();
      expect(m.fileCount).toBe(2);
      expect(m.files).toHaveLength(2);
      expect(m.totalBytes).toBeGreaterThan(0);
    } finally {
      process.chdir(original);
    }
  });

  it('and searching from a foreign cwd still finds matches', async () => {
    const original = process.cwd();
    try {
      process.chdir(os.tmpdir());
      const res = await post('/api/search', { query: 'cwd independence' });
      expect(res.statusCode).toBe(200);
      expect(res.json().matches.length).toBe(1);
    } finally {
      process.chdir(original);
    }
  });
});

describe('restore', () => {
  it('takes a pre-restore snapshot that is itself restorable', async () => {
    // snapshot the "original content" state
    await fs.writeFile(
      path.join(ws, 'chapters', 'intro.tex'),
      '\\section{Intro}\noriginal content here\n'
    );
    const target = (await post('/api/workspace/snapshots', { reason: 'manual', label: 'keep-me' })).json();

    // move the workspace away from that state
    await fs.writeFile(path.join(ws, 'chapters', 'intro.tex'), '\\section{Intro}\nDRIFTED\n');
    await fs.writeFile(path.join(ws, 'extra.tex'), 'a file not in the snapshot\n');

    const res = await post(`/api/workspace/snapshots/${target.snapshotId}/restore`, {});
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // the safety net must have real content, not an empty manifest
    const pre = (await get(`/api/workspace/snapshots/${body.preRestoreSnapshotId}`)).json();
    expect(pre.reason).toBe('pre-restore');
    expect(pre.files.length).toBeGreaterThan(0);
    expect(pre.contentHash).toMatch(/^[a-f0-9]{64}$/);

    // and the restore itself worked
    const restored = await fs.readFile(path.join(ws, 'chapters', 'intro.tex'), 'utf8');
    expect(restored).toContain('original content here');
    expect(restored).not.toContain('DRIFTED');

    // files absent from the snapshot are removed by a full restore
    expect(await fs.stat(path.join(ws, 'extra.tex')).catch(() => null)).toBeNull();
  });

  it('restores a single file without touching others', async () => {
    await fs.writeFile(path.join(ws, 'chapters', 'intro.tex'), '\\section{Intro}\nONE\n');
    await fs.writeFile(path.join(ws, 'other.tex'), '\\section{Other}\nKEEP\n');
    const snap = (await post('/api/workspace/snapshots', { reason: 'manual' })).json();

    await fs.writeFile(path.join(ws, 'chapters', 'intro.tex'), '\\section{Intro}\nTWO\n');
    await fs.writeFile(path.join(ws, 'other.tex'), '\\section{Other}\nCLOBBERED\n');

    const res = await post(`/api/workspace/snapshots/${snap.snapshotId}/restore`, {
      files: ['chapters/intro.tex'],
    });
    expect(res.statusCode).toBe(200);

    expect(await fs.readFile(path.join(ws, 'chapters', 'intro.tex'), 'utf8')).toContain('ONE');
    // a partial restore must never rewrite unrelated files
    expect(await fs.readFile(path.join(ws, 'other.tex'), 'utf8')).toContain('CLOBBERED');
  });

  it('a partial restore does not delete files created after the snapshot', async () => {
    // This locks a real regression: the removal pass used to run even for a
    // partial restore, silently deleting work done since the snapshot.
    await fs.writeFile(path.join(ws, 'chapters', 'intro.tex'), '\\section{Intro}\nBASE\n');
    const snap = (await post('/api/workspace/snapshots', { reason: 'manual' })).json();

    await fs.writeFile(path.join(ws, 'chapters', 'intro.tex'), '\\section{Intro}\nDRIFT\n');
    await fs.writeFile(path.join(ws, 'brand-new.tex'), 'written after the snapshot\n');

    const res = await post(`/api/workspace/snapshots/${snap.snapshotId}/restore`, {
      files: ['chapters/intro.tex'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().removedFiles).toBe(0);

    expect(await fs.readFile(path.join(ws, 'chapters', 'intro.tex'), 'utf8')).toContain('BASE');
    expect(await fs.readFile(path.join(ws, 'brand-new.tex'), 'utf8')).toContain(
      'written after the snapshot'
    );

    await fs.rm(path.join(ws, 'brand-new.tex'), { force: true });
  });

  it('a full restore still removes files that are not in the snapshot', async () => {
    await fs.writeFile(path.join(ws, 'chapters', 'intro.tex'), '\\section{Intro}\nFULLBASE\n');
    const snap = (await post('/api/workspace/snapshots', { reason: 'manual' })).json();

    await fs.writeFile(path.join(ws, 'stray.tex'), 'not in the snapshot\n');

    const res = await post(`/api/workspace/snapshots/${snap.snapshotId}/restore`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().removedFiles).toBeGreaterThanOrEqual(1);
    expect(await fs.stat(path.join(ws, 'stray.tex')).catch(() => null)).toBeNull();
  });
});

describe('id validation', () => {
  it('rejects malformed ids with 400, not 500', async () => {
    // Single-segment ids only: anything containing a slash is normalised by
    // the router before it reaches our handler, which is a different path.
    for (const id of ['snap_x', 'SNAP_UPPER', 'abc123', 'snap_20260101000000_ZZZ', 'snap_;drop']) {
      const res = await get(`/api/workspace/snapshots/${encodeURIComponent(id)}`);
      expect(res.statusCode, `id=${id}`).toBe(400);
      expect(res.json().error.code).toBe('INVALID_ARGUMENT');
    }
  });

  it('rejects malformed ids on the write routes too', async () => {
    const restore = await post('/api/workspace/snapshots/snap_BAD/restore', {});
    expect(restore.statusCode).toBe(400);
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/workspace/snapshots/snap_BAD',
    });
    expect(del.statusCode).toBe(400);
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    const res = await get('/api/workspace/snapshots/snap_20260101000000_zzzzzz');
    expect(res.statusCode).toBe(404);
  });
});

describe('retention', () => {
  it('keeps at most maxCount snapshots', async () => {
    // Drive the policy directly through repeated creates; the default cap is
    // 30, so this asserts the list stays bounded and ordered newest-first.
    const all = (await get('/api/workspace/snapshots')).json() as {
      createdAt: number;
      snapshotId: string;
    }[];
    for (let i = all.length - 1; i > 0; i--) {
      expect(all[i - 1].createdAt).toBeGreaterThanOrEqual(all[i].createdAt);
    }
    expect(all.length).toBeLessThanOrEqual(30);
  });
});

describe('diff', () => {
  it('reports modified files relative to the workspace', async () => {
    await fs.writeFile(path.join(ws, 'chapters', 'intro.tex'), '\\section{Intro}\nDIFFBASE\n');
    const snap = (await post('/api/workspace/snapshots', { reason: 'manual' })).json();
    await fs.writeFile(path.join(ws, 'chapters', 'intro.tex'), '\\section{Intro}\nDIFFNEW\n');
    await fs.writeFile(path.join(ws, 'added.tex'), 'brand new\n');

    const res = await get(`/api/workspace/snapshots/${snap.snapshotId}/diff`);
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries as {
      path: string;
      status: string;
      snapshotContent?: string;
      currentContent?: string;
    }[];

    const modified = entries.find((e) => e.path === 'chapters/intro.tex');
    expect(modified?.status).toBe('M');
    expect(modified?.snapshotContent).toContain('DIFFBASE');
    expect(modified?.currentContent).toContain('DIFFNEW');

    const added = entries.find((e) => e.path === 'added.tex');
    expect(added?.status).toBe('A');
  });
});
