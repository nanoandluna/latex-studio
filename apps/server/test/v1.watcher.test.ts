import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileWatcher } from '../src/services/fileWatcher.js';
import { projectIndexService } from '../src/services/projectIndexService.js';
import { createApp } from '../src/app.js';

let root: string;
let watcher: FileWatcher;
let changes: string[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-watch-v1-'));
  watcher = new FileWatcher();
  changes = [];
  watcher.onChange = (paths) => changes.push(...paths);
});
afterEach(async () => {
  await watcher.dispose();
  await fs.rm(root, { recursive: true, force: true });
});

async function attach(): Promise<void> {
  watcher.start(root);
  await vi.waitFor(() => expect(changes).toContain('.'), { timeout: 5000 });
  changes.length = 0;
}

it('observes nested external bibliography edits and directory deletion', async () => {
  await fs.mkdir(path.join(root, 'references'));
  await fs.writeFile(path.join(root, 'references', 'refs.bib'), '@article{old}');
  await attach();
  await fs.writeFile(path.join(root, 'references', 'refs.bib'), '@article{updated}');
  await vi.waitFor(() => expect(changes).toContain('references/refs.bib'), { timeout: 5000 });
  changes.length = 0;
  await fs.rm(path.join(root, 'references'), { recursive: true });
  await vi.waitFor(() => expect(changes).toContain('references'), { timeout: 5000 });
});

it('ignores build artifacts and emits nothing after disposal', async () => {
  await fs.mkdir(path.join(root, '.build'));
  await attach();
  await fs.writeFile(path.join(root, '.build', 'main.aux'), 'artifact');
  await fs.writeFile(path.join(root, 'main.tex'), 'source');
  await vi.waitFor(() => expect(changes).toContain('main.tex'), { timeout: 5000 });
  expect(changes.some((name) => name.startsWith('.build'))).toBe(false);
  await watcher.dispose();
  changes.length = 0;
  await fs.writeFile(path.join(root, 'main.tex'), 'after close');
  await fs.rm(root, { recursive: true });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(changes).toEqual([]);
  expect(watcher.active).toBe(false);
});

it('releases the workspace monitor when the server closes', async () => {
  await fs.writeFile(path.join(root, 'main.tex'), '\\documentclass{article}');
  const app = await createApp();
  try {
    expect((await app.inject({ method: 'POST', url: '/api/workspace/open', payload: { path: root } })).statusCode).toBe(200);
    expect(projectIndexService.watcherActive).toBe(true);
  } finally {
    await app.close();
  }
  expect(projectIndexService.watcherActive).toBe(false);
});
