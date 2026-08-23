import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

let tmpRoot: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-test-'));
  await fs.writeFile(
    path.join(tmpRoot, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n'
  );
  await fs.mkdir(path.join(tmpRoot, 'sections'));
  await fs.writeFile(path.join(tmpRoot, 'sections', 'method.tex'), '\\section{Method}\n');
  await fs.writeFile(path.join(tmpRoot, 'refs.bib'), '@article{smith2025,\n title={T},\n}\n');
  app = await createApp();
});

afterAll(async () => {
  await app.close();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function openWorkspace() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/workspace/open',
    payload: { path: tmpRoot },
  });
  return res;
}

describe('workspace API', () => {
  it('opens a valid workspace and detects main file', async () => {
    const res = await openWorkspace();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mainFile).toBe('main.tex');
    expect(body.name).toBe(path.basename(tmpRoot));
  });

  it('rejects opening a non-directory', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspace/open',
      payload: { path: path.join(tmpRoot, 'main.tex') },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns the file tree ignoring hidden/build dirs', async () => {
    await openWorkspace();
    await fs.mkdir(path.join(tmpRoot, '.build'), { recursive: true });
    const res = await app.inject({ method: 'GET', url: '/api/workspace/tree' });
    expect(res.statusCode).toBe(200);
    const names = JSON.stringify(res.json());
    expect(names).toContain('main.tex');
    expect(names).toContain('method.tex');
    expect(names).not.toContain('.build');
  });
});

describe('file API', () => {
  beforeEach(openWorkspace);

  it('reads a file', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/file/read', query: { path: 'main.tex' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain('\\documentclass');
  });

  it('saves a file', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/file/save',
      payload: { path: 'main.tex', content: '% edited\n\\documentclass{article}\n' },
    });
    expect(res.statusCode).toBe(200);
    const onDisk = await fs.readFile(path.join(tmpRoot, 'main.tex'), 'utf8');
    expect(onDisk).toContain('% edited');
  });

  it('creates, renames and deletes a file', async () => {
    let res = await app.inject({
      method: 'POST',
      url: '/api/file/create',
      payload: { path: 'sections/new.tex', content: '' },
    });
    expect(res.statusCode).toBe(200);
    res = await app.inject({
      method: 'POST',
      url: '/api/file/rename',
      payload: { from: 'sections/new.tex', to: 'sections/renamed.tex' },
    });
    expect(res.statusCode).toBe(200);
    res = await app.inject({
      method: 'POST',
      url: '/api/file/delete',
      payload: { path: 'sections/renamed.tex' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('creates a directory', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/file/create',
      payload: { path: 'figures', type: 'directory' },
    });
    expect(res.statusCode).toBe(200);
    const stat = await fs.stat(path.join(tmpRoot, 'figures'));
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('security', () => {
  beforeEach(openWorkspace);

  it.each([
    ['../../etc/passwd'],
    ['..\\..\\windows\\win.ini'],
    ['/absolute/path/main.tex'],
    ['D:\\elsewhere\\main.tex'],
    ['C:/Windows/win.ini'],
  ])('blocks traversal for %j', async (p) => {
    const res = await app.inject({ method: 'GET', url: '/api/file/read', query: { path: p } });
    expect([403, 400]).toContain(res.statusCode);
  });

  it('blocks traversal in save', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/file/save',
      payload: { path: '../outside.txt', content: 'evil' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('blocks deleting the workspace root', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/file/delete',
      payload: { path: '.' },
    });
    expect([400, 403]).toContain(res.statusCode);
  });

  it('rejects file ops when no workspace is open', async () => {
    await app.inject({ method: 'POST', url: '/api/workspace/close' });
    const res = await app.inject({ method: 'GET', url: '/api/workspace/tree' });
    expect(res.statusCode).toBe(409);
    await openWorkspace();
  });
});

describe('bib/label scanning', () => {
  beforeEach(openWorkspace);

  it('collects bib keys', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspace/bibkeys' });
    const keys = res.json().keys;
    expect(keys.some((k: { key: string }) => k.key === 'smith2025')).toBe(true);
  });

  it('collects labels', async () => {
    await fs.writeFile(path.join(tmpRoot, 'sections', 'method.tex'), '\\section{M}\\label{sec:method}\n');
    const res = await app.inject({ method: 'GET', url: '/api/workspace/labels' });
    const labels = res.json().labels;
    expect(labels.some((l: { key: string }) => l.key === 'sec:method')).toBe(true);
  });
});
