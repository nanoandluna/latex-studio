import fsp from 'node:fs/promises';
import path from 'node:path';
import { isIgnoredWorkspacePath, isMetadataOrArtifact } from '../services/fileWatcher.js';

/**
 * Single source of truth for "which files belong to a LaTeX project".
 *
 * The exclusion predicate lives in fileWatcher.ts because the watcher must
 * never schedule work for artifacts or metadata; snapshots, search and export
 * consume the very same rule so the four consumers cannot drift apart.
 *
 * Symlinks and junctions are skipped: a link can point outside the workspace
 * and following it would defeat the jail enforced elsewhere.
 */
export async function collectSourceFiles(
  root: string,
  opts: { includeHidden?: boolean } = {}
): Promise<string[]> {
  const out: string[] = [];
  const exclude = opts.includeHidden ? isMetadataOrArtifact : isIgnoredWorkspacePath;
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let entries;
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (exclude(`${rel}/`)) continue;
        await walk(path.join(absDir, e.name), rel);
      } else if (e.isFile()) {
        if (exclude(rel)) continue;
        out.push(rel);
      }
    }
  };
  await walk(path.resolve(root), '');
  return out.sort();
}
