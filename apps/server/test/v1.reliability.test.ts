import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { SnapshotStore } from '../src/services/snapshots/snapshotStore.js';

let app: Awaited<ReturnType<typeof createApp>>;
let root: string;
let outside: string;
const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-v1-'));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-outside-'));
  await fs.writeFile(path.join(root, 'main.tex'), '\\documentclass{article}\n\\begin{document}Hello\\end{document}');
  app = await createApp();
  await post('/api/workspace/open', { path: root });
});
afterAll(async () => {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe('V1 save integrity', () => {
  it('rejects a stale baseline and preserves the disk version', async () => {
    await fs.writeFile(path.join(root, 'draft.tex'), 'external change');
    const res = await post('/api/file/save', { path: 'draft.tex', content: 'old buffer', expectedContent: 'original', workspacePath: root });
    expect(res.statusCode).toBe(409);
    expect(await fs.readFile(path.join(root, 'draft.tex'), 'utf8')).toBe('external change');
  });
  it('serializes concurrent saves; exactly one stale writer may succeed', async () => {
    await fs.writeFile(path.join(root, 'draft.tex'), 'base');
    const results = await Promise.all(['first', 'second'].map((content) => post('/api/file/save', {
      path: 'draft.tex', content, expectedContent: 'base', workspacePath: root,
    })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(['first', 'second']).toContain(await fs.readFile(path.join(root, 'draft.tex'), 'utf8'));
    expect((await fs.readdir(root)).some((f) => f.startsWith('.lstudio-'))).toBe(false);
  });
  it('rejects saves belonging to another workspace', async () => {
    const res = await post('/api/file/save', { path: 'draft.tex', content: 'wrong project', workspacePath: outside });
    expect(res.statusCode).toBe(409);
  });
  it('does not overwrite an existing rename destination', async () => {
    await fs.writeFile(path.join(root, 'other.tex'), 'keep me');
    expect((await post('/api/file/rename', { from: 'draft.tex', to: 'other.tex' })).statusCode).toBe(409);
    expect(await fs.readFile(path.join(root, 'other.tex'), 'utf8')).toBe('keep me');
  });
  it('rejects normalized workspace-root deletion', async () => {
    const res = await post('/api/file/delete', { path: 'sub/..' });
    expect(res.statusCode).toBe(400);
    expect(await fs.stat(path.join(root, 'main.tex'))).toBeTruthy();
  });
  it('jails text reads, new writes, creates and renames through junctions', async () => {
    await fs.writeFile(path.join(outside, 'private.tex'), 'private');
    await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const read = await app.inject({ url: '/api/file/read?path=escape/private.tex' });
    expect(read.statusCode).toBe(403);
    for (const [url, payload] of [
      ['/api/file/save', { path: 'escape/new.tex', content: 'bad' }],
      ['/api/file/create', { path: 'escape/new.tex', content: 'bad' }],
      ['/api/file/rename', { from: 'draft.tex', to: 'escape/new.tex' }],
    ] as const) expect((await post(url, payload)).statusCode).toBe(403);
    expect(await fs.readFile(path.join(outside, 'private.tex'), 'utf8')).toBe('private');
    expect(await fs.stat(path.join(outside, 'new.tex')).catch(() => null)).toBeNull();
    await fs.unlink(path.join(root, 'escape'));
  });
});

describe('V1 snapshot recovery', () => {
  it('replaces an unchanged but corrupted snapshot with a healthy capture', async () => {
    await fs.writeFile(path.join(root, 'draft.tex'), 'identical source');
    const snapshot = (await post('/api/workspace/snapshots', { reason: 'manual' })).json();
    await fs.writeFile(path.join(root, '.latex-studio', 'snapshots', snapshot.snapshotId, 'files', 'draft.tex'), 'broken snapshot');
    const fresh = (await post('/api/workspace/snapshots', { reason: 'manual' })).json();
    expect(fresh.skipped).toBe(false);
    expect(fresh.snapshotId).not.toBe(snapshot.snapshotId);
    expect(await fs.readFile(path.join(root, '.latex-studio', 'snapshots', fresh.snapshotId, 'files', 'draft.tex'), 'utf8')).toBe('identical source');
  });
  it('refuses snapshot publication through escaping metadata junctions', async () => {
    const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-meta-jail-'));
    try {
      await fs.symlink(outside, path.join(isolated, '.latex-studio'), process.platform === 'win32' ? 'junction' : 'dir');
      const store = new SnapshotStore(isolated);
      await expect(store.create({ reason: 'manual', mainFile: 'main.tex', files: ['main.tex'], readContent: async () => Buffer.from('source') })).rejects.toThrow();
      expect(await fs.stat(path.join(outside, 'snapshots')).catch(() => null)).toBeNull();
      await fs.unlink(path.join(isolated, '.latex-studio'));
    } finally { await fs.rm(isolated, { recursive: true, force: true }); }
  });
  it('restores deleted files and deleted parent folders', async () => {
    await fs.mkdir(path.join(root, 'chapters'));
    await fs.writeFile(path.join(root, 'chapters', 'deleted.tex'), 'recover this');
    const snapshot = (await post('/api/workspace/snapshots', { reason: 'manual' })).json();
    await fs.rm(path.join(root, 'chapters'), { recursive: true });
    const res = await post(`/api/workspace/snapshots/${snapshot.snapshotId}/restore`, { files: ['chapters/deleted.tex'] });
    expect(res.statusCode).toBe(200);
    expect(res.json().failed).toEqual([]);
    expect(await fs.readFile(path.join(root, 'chapters', 'deleted.tex'), 'utf8')).toBe('recover this');
  });
  it('rejects corrupted bytes before modifying or deleting any source', async () => {
    await fs.writeFile(path.join(root, 'draft.tex'), 'snapshot base');
    const snapshot = (await post('/api/workspace/snapshots', { reason: 'manual' })).json();
    await fs.writeFile(path.join(root, '.latex-studio', 'snapshots', snapshot.snapshotId, 'files', 'draft.tex'), 'corrupted');
    await fs.writeFile(path.join(root, 'draft.tex'), 'current writing');
    await fs.writeFile(path.join(root, 'new.tex'), 'new work');
    const res = await post(`/api/workspace/snapshots/${snapshot.snapshotId}/restore`, {});
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('SNAPSHOT_FAILED');
    expect(await fs.readFile(path.join(root, 'draft.tex'), 'utf8')).toBe('current writing');
    expect(await fs.readFile(path.join(root, 'new.tex'), 'utf8')).toBe('new work');
  });
  it('rejects an empty partial restore rather than restoring the entire project', async () => {
    const snapshot = (await post('/api/workspace/snapshots', { reason: 'manual' })).json();
    const res = await post(`/api/workspace/snapshots/${snapshot.snapshotId}/restore`, { files: [] });
    expect(res.statusCode).toBe(400);
  });
});

it('attributes citations in heading-free input files to their assembled chapter', async () => {
  await fs.writeFile(path.join(root, 'main.tex'), '\\documentclass{report}\n\\begin{document}\n\\chapter{Parent chapter}\n\\input{z-child}\n\\chapter{Later chapter}\n\\input{a-child}\n\\bibliography{refs}\n\\end{document}');
  await fs.writeFile(path.join(root, 'z-child.tex'), 'First citation \\cite{first}.');
  await fs.writeFile(path.join(root, 'a-child.tex'), 'Second citation \\cite{second}.');
  await fs.writeFile(path.join(root, 'refs.bib'), '@article{first,title={First},doi={10.1234/first}}\n@article{second,title={Second},url={https://example.org/paper}}');
  await post('/api/index/refresh', {});
  const res = await app.inject({ url: '/api/paper/citations' });
  const entries = res.json().entries;
  expect(entries[0].key).toBe('first');
  expect(entries[0].firstUsage.chapter).toBe('Parent chapter');
  expect(entries[0].doi).toBe('10.1234/first');
  expect(entries[1].firstUsage.chapter).toBe('Later chapter');
});
