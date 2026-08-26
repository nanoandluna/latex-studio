import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileNode } from '@latex-studio/shared';
import { safeResolve, isDirectory, isTextFile } from '../utils/paths.js';
import { ApiError } from '../errors.js';

const IGNORED_DIRS = new Set(['.git', '.build', 'node_modules', '__pycache__']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

export class WorkspaceService {
  private root: string | null = null;

  get workspacePath(): string | null {
    return this.root;
  }

  get workspaceName(): string | null {
    return this.root ? path.basename(this.root) : null;
  }

  requireWorkspace(): string {
    if (!this.root) {
      throw new ApiError('WORKSPACE_NOT_OPEN', 'No workspace is open');
    }
    return this.root;
  }

  async open(dirPath: string): Promise<{ path: string; name: string }> {
    const resolved = path.resolve(dirPath);
    if (!(await isDirectory(resolved))) {
      throw new ApiError('WORKSPACE_NOT_FOUND', `Not a directory: ${dirPath}`, 400);
    }
    this.root = resolved;
    return { path: resolved, name: path.basename(resolved) };
  }

  async close(): Promise<void> {
    this.root = null;
  }

  /** Build the file tree of the open workspace. */
  async getTree(): Promise<FileNode> {
    const root = this.requireWorkspace();
    return this.walk(root, '');
  }

  private async walk(absDir: string, relDir: string): Promise<FileNode> {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    const children: FileNode[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
      if (IGNORED_DIRS.has(entry.name) || IGNORED_FILES.has(entry.name)) continue;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      // V0.3 security: skip links that may escape the workspace.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        children.push(await this.walk(path.join(absDir, entry.name), relPath));
      } else if (entry.isFile()) {
        children.push({ name: entry.name, path: relPath, type: 'file' });
      }
    }

    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });

    return {
      name: relDir || path.basename(absDir),
      path: relDir,
      type: 'directory',
      children,
    };
  }

  async readFile(relPath: string): Promise<string> {
    const root = this.requireWorkspace();
    const abs = safeResolve(root, relPath);
    return fs.readFile(abs, 'utf8');
  }

  async saveFile(relPath: string, content: string): Promise<void> {
    const root = this.requireWorkspace();
    const abs = safeResolve(root, relPath);
    // Same rule as createFile: refuse to write text content into
    // binary-extension files.
    if (!isTextFile(relPath) && content.length > 0) {
      throw new ApiError('INVALID_FILE', `Refusing to write text content into binary-looking file: ${relPath}`, 400);
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }

  async createFile(relPath: string, content = ''): Promise<void> {
    const root = this.requireWorkspace();
    const abs = safeResolve(root, relPath);
    if (!isTextFile(relPath)) {
      // allow creating binary-ish files as empty; refuse non-empty content
      if (content) {
        throw new ApiError('INVALID_FILE', `Refusing to write text content into binary-looking file: ${relPath}`, 400);
      }
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'EEXIST') {
        throw new ApiError('CONFLICT', `File already exists: ${relPath}`);
      }
      throw e;
    });
  }

  async createDirectory(relPath: string): Promise<void> {
    const root = this.requireWorkspace();
    const abs = safeResolve(root, relPath);
    await fs.mkdir(abs, { recursive: false }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'EEXIST') {
        throw new ApiError('CONFLICT', `Directory already exists: ${relPath}`);
      }
      throw e;
    });
  }

  async deleteEntry(relPath: string): Promise<void> {
    const root = this.requireWorkspace();
    if (!relPath || relPath === '.' || relPath === '/') {
      throw new ApiError('INVALID_ARGUMENT', 'Refusing to delete the workspace root');
    }
    const abs = safeResolve(root, relPath);
    await fs.rm(abs, { recursive: true, force: false });
  }

  async renameEntry(fromRel: string, toRel: string): Promise<void> {
    const root = this.requireWorkspace();
    const fromAbs = safeResolve(root, fromRel);
    const toAbs = safeResolve(root, toRel);
    await fs.mkdir(path.dirname(toAbs), { recursive: true });
    await fs.rename(fromAbs, toAbs).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'EEXIST' || e.code === 'EPERM') {
        throw new ApiError('CONFLICT', `Target already exists: ${toRel}`);
      }
      throw e;
    });
  }

  /** Detect the project's main .tex file: main.tex first, else \documentclass scan. */
  async detectMainFile(): Promise<string | null> {
    const root = this.requireWorkspace();
    const candidates = ['main.tex'];
    for (const c of candidates) {
      try {
        await fs.access(path.join(root, c));
        return c;
      } catch {
        /* keep looking */
      }
    }

    // Scan all .tex files (top level + one level deep) for \documentclass
    const found: { file: string; depth: number }[] = [];
    const scan = async (absDir: string, relDir: string, depth: number): Promise<void> => {
      if (depth > 2) return;
      let entries;
      try {
        entries = await fs.readdir(absDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.tex')) continue;
        const rel = relDir ? `${relDir}/${e.name}` : e.name;
        try {
          const content = await fs.readFile(path.join(absDir, e.name), 'utf8');
          if (/^\s*\\documentclass\b/m.test(content)) found.push({ file: rel, depth });
        } catch {
          /* ignore */
        }
      }
      for (const e of entries) {
        if (e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) {
          await scan(path.join(absDir, e.name), relDir ? `${relDir}/${e.name}` : e.name, depth + 1);
        }
      }
    };

    await scan(root, '', 0);
    found.sort((a, b) => a.depth - b.depth);
    return found[0]?.file ?? null;
  }

  private async forEachFile(
    absDir: string,
    relDir: string,
    fn: (rel: string, abs: string) => Promise<void>
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name)) continue;
      if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      const abs = path.join(absDir, e.name);
      if (e.isDirectory()) {
        await this.forEachFile(abs, rel, fn);
      } else if (e.isFile()) {
        await fn(rel, abs);
      }
    }
  }
}

export const workspaceService = new WorkspaceService();
