import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeRealpathForWrite } from './paths.js';

/** Publish complete bytes with a same-directory rename; never truncate the original. */
export async function atomicWrite(root: string, target: string, content: string | Buffer): Promise<void> {
  await safeRealpathForWrite(root, target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await safeRealpathForWrite(root, target);
  const temporary = path.join(path.dirname(target), `.lstudio-${randomUUID()}.tmp`);
  let handle;
  try {
    const mode = await fs.stat(target).then((s) => s.mode).catch(() => 0o666);
    handle = await fs.open(temporary, 'wx', mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await safeRealpathForWrite(root, target);
    await fs.rename(temporary, target);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}
