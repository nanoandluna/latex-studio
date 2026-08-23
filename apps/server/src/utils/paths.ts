import path from 'node:path';
import { promises as fs } from 'node:fs';

export class PathTraversalError extends Error {
  constructor(relPath: string) {
    super(`Path escapes workspace root: ${relPath}`);
    this.name = 'PathTraversalError';
  }
}

/**
 * Resolve a workspace-relative path and guarantee the result stays inside
 * `root`. Rejects absolute paths, drive letters, and any .. traversal.
 */
export function safeResolve(root: string, relPath: string): string {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new PathTraversalError(String(relPath));
  }
  const normalized = path.posix.normalize(relPath.replace(/\\/g, '/'));
  if (
    path.isAbsolute(relPath) ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('\0')
  ) {
    throw new PathTraversalError(relPath);
  }
  const resolved = path.resolve(root, normalized);
  const resolvedRoot = path.resolve(root);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new PathTraversalError(relPath);
  }
  return resolved;
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const TEXT_EXTENSIONS = new Set([
  '.tex', '.bib', '.sty', '.cls', '.txt', '.md', '.json', '.yaml', '.yml',
  '.bst', '.bbx', '.cbx', '.def', '.cfg', '.clo', '.fd', '.dtx', '.ins',
  '.tikz', '.csv', '.lua', '.ist', '.nlo', '.gitignore',
]);

export function isTextFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (!ext) return false;
  return false;
}
