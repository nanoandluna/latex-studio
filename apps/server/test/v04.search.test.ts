import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

/**
 * V0.4 Search & Replace — capability matrix, jail behaviour, and the
 * two-stage apply.
 *
 * The jail cases matter most: a replace writes to disk, so it must be
 * unreachable for anything that is not a workspace source path, and it must
 * never happen without a safety snapshot.
 */

let ws: string;
let app: Awaited<ReturnType<typeof createApp>>;

const post = (url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });

beforeAll(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-v04-search-'));
  await fs.mkdir(path.join(ws, 'chapters'), { recursive: true });
  await fs.writeFile(
    path.join(ws, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\n\\input{chapters/intro}\n\\end{document}\n'
  );
  await fs.writeFile(
    path.join(ws, 'chapters', 'intro.tex'),
    ['Alpha alpha ALPHA', 'the cat sat on the cathedral', 'todo: fix this', ''].join('\n')
  );
  await fs.writeFile(path.join(ws, 'notes.txt'), 'alpha in a non-tex file\n');

  app = await createApp();
  await post('/api/workspace/open', { path: ws });
});

afterAll(async () => {
  await app?.close();
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
});

describe('search capability matrix', () => {
  it('finds matches and reports the file count', async () => {
    const res = await post('/api/search', { query: 'alpha' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 3 in chapters/intro.tex + 1 in notes.txt (.txt is a searchable source)
    expect(body.matches.length).toBe(4);
    expect(body.fileCount).toBe(2);
  });

  it('honours case sensitivity', async () => {
    const insensitive = await post('/api/search', { query: 'alpha' });
    const sensitive = await post('/api/search', { query: 'alpha', caseSensitive: true });
    expect(insensitive.json().matches.length).toBe(4);
    expect(sensitive.json().matches.length).toBe(2); // lowercase "alpha" only
  });

  it('honours whole word', async () => {
    const all = await post('/api/search', { query: 'cat' });
    const whole = await post('/api/search', { query: 'cat', wholeWord: true });
    expect(all.json().matches.length).toBe(2); // cat + cathedral
    expect(whole.json().matches.length).toBe(1);
  });

  it('honours regex mode', async () => {
    const res = await post('/api/search', { query: '^todo:', regex: true });
    expect(res.json().matches.length).toBe(1);
  });

  it('rejects an invalid regex instead of throwing', async () => {
    const res = await post('/api/search', { query: '(unclosed', regex: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ARGUMENT');
  });

  it('applies include and exclude globs', async () => {
    const onlyChapters = await post('/api/search', {
      query: 'alpha',
      includeGlob: 'chapters/**',
    });
    expect(onlyChapters.json().matches.length).toBe(3);

    const withoutChapters = await post('/api/search', {
      query: 'alpha',
      excludeGlob: 'chapters/**',
    });
    // only the notes.txt hit survives
    expect(withoutChapters.json().matches.length).toBe(1);
  });

  it('returns line, column and match length so the UI can highlight', async () => {
    const res = await post('/api/search', { query: 'cathedral' });
    const m = res.json().matches[0];
    expect(m.line).toBe(2);
    expect(m.length).toBe('cathedral'.length);
    expect(m.column).toBeGreaterThan(1);
  });

  it('requires a query', async () => {
    const res = await post('/api/search', {});
    expect(res.statusCode).toBe(400);
  });
});

describe('replace is two-stage', () => {
  it('refuses to apply without a confirm token', async () => {
    const res = await post('/api/search/replace/apply', {
      query: 'alpha',
      replacement: 'beta',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CONFIRMATION_REQUIRED');
  });

  it('refuses to apply with a fabricated token', async () => {
    const res = await post('/api/search/replace/apply', {
      query: 'alpha',
      replacement: 'beta',
      confirmToken: 'not-a-real-token',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CONFIRMATION_REQUIRED');
  });

  it('preview writes nothing and reports what would change', async () => {
    const before = await fs.readFile(path.join(ws, 'chapters', 'intro.tex'), 'utf8');
    const res = await post('/api/search/replace/preview', {
      query: 'ALPHA',
      replacement: 'OMEGA',
      caseSensitive: true,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.confirmToken).toBeTruthy();
    expect(body.totalReplacements).toBe(1);
    // still untouched on disk
    expect(await fs.readFile(path.join(ws, 'chapters', 'intro.tex'), 'utf8')).toBe(before);
  });

  it('a token is single use', async () => {
    const preview = await post('/api/search/replace/preview', {
      query: 'ALPHA',
      replacement: 'OMEGA',
      caseSensitive: true,
    });
    const token = preview.json().confirmToken;

    const first = await post('/api/search/replace/apply', {
      query: 'ALPHA',
      replacement: 'OMEGA',
      caseSensitive: true,
      confirmToken: token,
    });
    expect(first.statusCode).toBe(200);

    const second = await post('/api/search/replace/apply', {
      query: 'ALPHA',
      replacement: 'OMEGA',
      caseSensitive: true,
      confirmToken: token,
    });
    expect(second.statusCode).toBe(400);
  });

  it('applies the change, takes a snapshot, and reports its id', async () => {
    const preview = await post('/api/search/replace/preview', {
      query: 'cat',
      replacement: 'dog',
      wholeWord: true,
      caseSensitive: true,
    });
    const res = await post('/api/search/replace/apply', {
      query: 'cat',
      replacement: 'dog',
      wholeWord: true,
      caseSensitive: true,
      confirmToken: preview.json().confirmToken,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json() as {
      ok: boolean;
      filesModified: number;
      totalReplacements: number;
      snapshotId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.filesModified).toBe(1);
    expect(body.totalReplacements).toBe(1);
    expect(body.snapshotId).toMatch(/^snap_\d{14}_[a-z0-9]+$/);

    const content = await fs.readFile(path.join(ws, 'chapters', 'intro.tex'), 'utf8');
    expect(content).toContain('the dog sat');
    expect(content).toContain('cathedral'); // whole-word means cathedral is untouched

    // the promised snapshot must actually exist and be pre-replace
    const snap = await app.inject({
      method: 'GET',
      url: `/api/workspace/snapshots/${body.snapshotId}`,
    });
    expect(snap.statusCode).toBe(200);
    expect(snap.json().reason).toBe('pre-replace');
  });

  it('a token does not authorise different parameters', async () => {
    const preview = await post('/api/search/replace/preview', {
      query: 'the',
      replacement: 'THE',
    });
    const res = await post('/api/search/replace/apply', {
      query: 'the',
      replacement: 'SOMETHING-ELSE',
      confirmToken: preview.json().confirmToken,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CONFIRMATION_REQUIRED');
  });
});
