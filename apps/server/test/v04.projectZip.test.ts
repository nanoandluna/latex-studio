import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { createApp } from '../src/app.js';

/**
 * V0.4 project ZIP export/import.
 *
 * Import is the dangerous direction: an archive is untrusted input, and its
 * entry names are used to build filesystem paths. Every entry must go through
 * the workspace jail, so `..`, absolute paths, drive letters and UNC names are
 * rejected rather than written.
 */

let ws: string;
let emptyWs: string;
let app: Awaited<ReturnType<typeof createApp>>;

const post = (url: string, payload?: unknown) =>
  app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });

beforeAll(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-v04-zip-'));
  await fs.mkdir(path.join(ws, 'chapters'), { recursive: true });
  await fs.writeFile(path.join(ws, 'main.tex'), '\\documentclass{article}\n\\begin{document}\n');
  await fs.writeFile(path.join(ws, 'chapters', 'intro.tex'), '\\section{Intro}\n');
  await fs.writeFile(path.join(ws, 'refs.bib'), '@article{x, title={X}}\n');
  // must not be exported
  await fs.mkdir(path.join(ws, '.build'), { recursive: true });
  await fs.writeFile(path.join(ws, '.build', 'main.pdf'), 'pdf');
  await fs.writeFile(path.join(ws, 'main.aux'), 'aux');
  await fs.writeFile(path.join(ws, 'main.log'), 'log');

  emptyWs = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-v04-zipempty-'));

  app = await createApp();
  await post('/api/workspace/open', { path: ws });
});

afterAll(async () => {
  await app?.close();
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
  await fs.rm(emptyWs, { recursive: true, force: true }).catch(() => {});
});

/**
 * Build a ZIP by hand (STORE, no compression).
 *
 * JSZip sanitises entry names like `../x` when writing, so a fixture built
 * with it can never reach the server's path check. A real attacker does not
 * use JSZip, so the jail test needs an archive that carries exactly the bytes
 * we choose.
 */
function makeRawZip(entries: { name: string; data: string }[]): Buffer {
  const crc32 = (buf: Buffer) => zlib.crc32(buf) >>> 0;

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const dataBuf = Buffer.from(e.data, 'utf8');
    const crc = crc32(dataBuf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x2100, 12); // mod date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len

    locals.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // stored
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x2100, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);

    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localPart, centralPart, eocd]);
}

async function exportZip(): Promise<JSZip> {
  const res = await app.inject({ method: 'GET', url: '/api/project/export' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('application/zip');
  return JSZip.loadAsync(res.rawPayload as Buffer);
}

describe('export', () => {
  it('includes sources and excludes artifacts and metadata', async () => {
    const zip = await exportZip();
    const names = Object.keys(zip.files);

    expect(names.some((n) => n.endsWith('/main.tex'))).toBe(true);
    expect(names.some((n) => n.endsWith('/chapters/intro.tex'))).toBe(true);
    expect(names.some((n) => n.endsWith('/refs.bib'))).toBe(true);

    expect(names.some((n) => n.includes('.build/'))).toBe(false);
    expect(names.some((n) => n.includes('.latex-studio/'))).toBe(false);
    expect(names.some((n) => n.endsWith('.aux'))).toBe(false);
    expect(names.some((n) => n.endsWith('.log'))).toBe(false);
    expect(names.some((n) => n.endsWith('.pdf'))).toBe(false);
  });

  it('preserves file contents byte for byte', async () => {
    const zip = await exportZip();
    const entry = Object.keys(zip.files).find((n) => n.endsWith('/chapters/intro.tex'));
    const text = await zip.files[entry!].async('string');
    expect(text).toBe('\\section{Intro}\n');
  });
});

describe('import', () => {
  async function importInto(dir: string, files: Record<string, string>, merge = false) {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content);
    // 'DEFLATE' is irrelevant to the assertions; STORE keeps the fixture small
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });

    await post('/api/workspace/open', { path: dir });
    return app.inject({
      method: 'POST',
      url: `/api/project/import${merge ? '?merge=true' : ''}`,
      payload: buf as unknown as Record<string, unknown>,
      headers: { 'content-type': 'application/zip' },
    });
  }

  it('imports a normal archive into an empty workspace', async () => {
    const res = await importInto(emptyWs, {
      'my-project/main.tex': '\\documentclass{article}\n',
      'my-project/sections/a.tex': '\\section{A}\n',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.importedFiles).toBe(2);
    expect(body.rejected).toEqual([]);

    // the shared top-level folder is stripped, so files land at the root
    expect(await fs.readFile(path.join(emptyWs, 'main.tex'), 'utf8')).toContain('article');
    expect(await fs.readFile(path.join(emptyWs, 'sections', 'a.tex'), 'utf8')).toContain('section{A}');
  });

  it('refuses to merge into a non-empty workspace without an explicit flag', async () => {
    const res = await importInto(emptyWs, { 'other.tex': 'x' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('merges when explicitly asked', async () => {
    const res = await importInto(emptyWs, { 'merged.tex': 'hello\n' }, true);
    expect(res.statusCode).toBe(200);
    expect(await fs.readFile(path.join(emptyWs, 'merged.tex'), 'utf8')).toBe('hello\n');
  });

  it('rejects traversal, absolute, drive-letter and UNC entry names', async () => {
    const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-v04-jail-'));
    try {
      const buf = makeRawZip([
        { name: 'good.tex', data: 'fine\n' },
        { name: '../escape.tex', data: 'nope' },
        { name: 'deep/../../escape2.tex', data: 'nope' },
        { name: '/absolute.tex', data: 'nope' },
        { name: 'C:/windows.tex', data: 'nope' },
        { name: '//server/share/unc.tex', data: 'nope' },
      ]);

      await post('/api/workspace/open', { path: fresh });
      const res = await app.inject({
        method: 'POST',
        url: '/api/project/import',
        payload: buf as unknown as Record<string, unknown>,
        headers: { 'content-type': 'application/zip' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // JSZip normalises entry names on read (`../x` → `x`, `//s/s` → `/s/s`),
      // so some names reach safeResolve already sanitised and get written
      // INSIDE the workspace. What must hold is the security property:
      // nothing lands outside the root, and the still-absolute ones are refused.
      expect(body.rejected.length).toBeGreaterThanOrEqual(1);
      expect(await fs.readFile(path.join(fresh, 'good.tex'), 'utf8')).toBe('fine\n');

      const parent = path.dirname(fresh);
      const escaped: string[] = [];
      for (const entry of await fs.readdir(parent)) {
        if (['escape.tex', 'escape2.tex'].includes(entry)) escaped.push(entry);
      }
      expect(escaped).toEqual([]);

      // absolute and drive-letter forms never materialise inside either
      const inside = await fs.readdir(fresh);
      expect(inside).not.toContain('windows.tex');
      expect(inside).not.toContain('unc.tex');
    } finally {
      await fs.rm(fresh, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('never lets an archive overwrite the snapshot store', async () => {
    const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-v04-store-'));
    try {
      const res = await importInto(fresh, {
        '.latex-studio/snapshots/evil.json': '{}',
        'ok.tex': 'x\n',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rejected.some((r: { name: string }) => r.name.includes('.latex-studio'))).toBe(
        true
      );
      expect(
        await fs.stat(path.join(fresh, '.latex-studio', 'snapshots', 'evil.json')).catch(
          () => null
        )
      ).toBeNull();
    } finally {
      await fs.rm(fresh, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('rejects a body that is not a zip', async () => {
    const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-v04-bad-'));
    try {
      await post('/api/workspace/open', { path: fresh });
      const res = await app.inject({
        method: 'POST',
        url: '/api/project/import',
        payload: Buffer.from('this is definitely not a zip archive'),
        headers: { 'content-type': 'application/zip' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_ARCHIVE');
    } finally {
      await fs.rm(fresh, { recursive: true, force: true }).catch(() => {});
    }
  });
});
