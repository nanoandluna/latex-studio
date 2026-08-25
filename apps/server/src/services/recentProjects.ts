import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RecentProject } from '@latex-studio/shared';

const MAX_RECENTS = 8;

function storePath(): string {
  return path.join(os.homedir(), '.latex-studio', 'recents.json');
}

export function readRecents(): RecentProject[] {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as { recents?: RecentProject[] };
    if (!Array.isArray(parsed.recents)) return [];
    return parsed.recents
      .filter((r) => typeof r.path === 'string' && typeof r.name === 'string')
      .slice(0, MAX_RECENTS);
  } catch {
    return []; // missing or corrupted → empty, never fatal
  }
}

/** Record a successfully opened workspace (validated by the caller). */
export function recordRecent(dirPath: string): RecentProject[] {
  const resolved = path.resolve(dirPath);
  const list = readRecents().filter((r) => path.resolve(r.path) !== resolved);
  const entry: RecentProject = {
    path: resolved,
    name: path.basename(resolved),
    lastOpened: Date.now(),
  };
  const next = [entry, ...list].slice(0, MAX_RECENTS);
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify({ recents: next }, null, 2));
  } catch {
    /* home dir not writable — recents are best-effort */
  }
  return next;
}
