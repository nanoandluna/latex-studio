import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CompilerInfo, LatexEnvironment } from '@latex-studio/shared';

const NAMES: Record<string, string> = {
  latexmk: 'LaTeXmk',
  xelatex: 'XeLaTeX',
  pdflatex: 'pdfLaTeX',
  lualatex: 'LuaLaTeX',
  bibtex: 'BibTeX',
  biber: 'Biber',
  synctex: 'SyncTeX',
};

export const DETECTED_IDS = Object.keys(NAMES);

interface ProbeResult {
  info: CompilerInfo;
}

function runVersion(cmd: string, timeoutMs = 6000): string | null {
  try {
    const res = spawnSync(cmd, ['--version'], {
      shell: false,
      timeout: timeoutMs,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, PATH: [...toolHelperDirs(), process.env.PATH].join(path.delimiter) },
    });
    if ((res.error && !(res.error as NodeJS.ErrnoException & { killed?: boolean }).killed) || (res.status !== 0 && !res.stdout)) {
      return null;
    }
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    const line = out.split(/\r?\n/).find((l) => l.trim().length > 0);
    return line ? line.trim().slice(0, 140) : null;
  } catch {
    return null;
  }
}

/** Locate a command on PATH, returning all candidate absolute paths. */
function locateOnPath(command: string): string[] {
  const isWin = process.platform === 'win32';
  try {
    const res = spawnSync(isWin ? 'where.exe' : 'which', [command], {
      shell: false,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (res.status !== 0 || !res.stdout) return [];
    return res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Common TeX installation directories per platform. */
function commonBinDirs(): string[] {
  const dirs: string[] = [];
  if (process.platform === 'win32') {
    const driveRe = /^[C-Z]:$/;
    for (const d of fsSync.readdirSync('/').filter((d) => driveRe.test(d))) {
      // TeX Live: X:\texlive\<year>\bin\windows(|\win32)
      const tlRoot = path.join(`${d}\\`, 'texlive');
      if (fsSync.existsSync(tlRoot)) {
        for (const year of safeRead(tlRoot)) {
          for (const bin of ['bin\\windows', 'bin\\win32', 'bin\\win64']) {
            const p = path.join(tlRoot, year, bin);
            if (fsSync.existsSync(p)) dirs.push(p);
          }
        }
      }
      // MiKTeX per-user and per-machine installs
      for (const rel of [
        'Program Files\\MiKTeX\\miktex\\bin\\x64',
        'Program Files (x86)\\MiKTeX\\miktex\\bin',
        'Users\\Public\\Programs\\MiKTeX\\miktex\\bin\\x64',
      ]) {
        const p = path.join(`${d}\\`, rel);
        if (fsSync.existsSync(p)) dirs.push(p);
      }
    }
    if (process.env.LOCALAPPDATA) {
      const p = path.join(process.env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64');
      if (fsSync.existsSync(p)) dirs.push(p);
    }
    // Strawberry Perl — required by latexmk on Windows
    const sp = `${process.env.SYSTEMDRIVE || 'C:'}\\Strawberry\\perl\\bin`;
    if (fsSync.existsSync(sp)) dirs.push(sp);
  } else if (process.platform === 'darwin') {
    dirs.push('/Library/TeX/texbin', '/usr/local/bin');
    if (process.env.HOME) {
      dirs.push(path.join(process.env.HOME, 'Library', 'TeX', 'texbin'));
    }
  } else {
    dirs.push('/usr/local/bin', '/usr/bin');
    if (process.env.HOME) {
      dirs.push(path.join(process.env.HOME, '.local', 'bin'));
    }
    const tlRoot = '/usr/local/texlive';
    if (fsSync.existsSync(tlRoot)) {
      for (const year of safeRead(tlRoot)) {
        for (const arch of safeRead(path.join(tlRoot, year, 'bin'))) {
          dirs.push(path.join(tlRoot, year, 'bin', arch));
        }
      }
    }
  }
  return dirs.filter((d) => fsSync.existsSync(d));
}

/**
 * Helper directories that compiled tools may need at spawn time
 * (e.g. Perl for latexmk). The ProcessManager appends these to the
 * child PATH so builds work even when they are not globally on PATH.
 */
export function toolHelperDirs(): string[] {
  return commonBinDirs().filter((d) => /perl|texlive|miktex/i.test(d));
}

function safeRead(dir: string): string[] {
  try {
    return fsSync.readdirSync(dir).sort().reverse();
  } catch {
    return [];
  }
}

/** Extra user-configured directories: $LATEX_STUDIO_EXTRA_PATH (path-sep list) + ~/.latex-studio.json */
function extraDirs(): string[] {
  const out: string[] = [];
  if (process.env.LATEX_STUDIO_EXTRA_PATH) {
    out.push(...process.env.LATEX_STUDIO_EXTRA_PATH.split(path.delimiter));
  }
  try {
    const cfg = path.join(os.homedir(), '.latex-studio.json');
    if (fsSync.existsSync(cfg)) {
      const parsed = JSON.parse(fsSync.readFileSync(cfg, 'utf8')) as { extraPaths?: string[] };
      if (Array.isArray(parsed.extraPaths)) out.push(...parsed.extraPaths);
    }
  } catch {
    /* ignore malformed config */
  }
  return out.filter((d) => d && fsSync.existsSync(d));
}

function findInDirs(command: string, dirs: string[], extensions: string[]): string | null {
  for (const dir of dirs) {
    for (const ext of extensions) {
      const p = path.join(dir, command + ext);
      if (fsSync.existsSync(p) && fsSync.statSync(p).isFile()) return p;
    }
  }
  return null;
}

/**
 * Detect one tool end-to-end:
 *   1. PATH lookup (where/which)
 *   2. common install locations
 *   3. extra user-configured dirs
 * then verifies it can be spawned directly (shell:false) with --version.
 */
export function detectTool(id: string): CompilerInfo {
  const base: CompilerInfo = {
    id,
    name: NAMES[id] ?? id,
    command: id,
    path: null,
    platform: process.platform,
    available: false,
  };

  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const searchDirs = [...commonBinDirs(), ...extraDirs()];
  const commandNames =
    id === 'latexmk' && process.platform === 'win32' ? ['latexmk', 'miktex-latexmk'] : [id];

  let shellWrapperOnly = false;

  for (const command of commandNames) {
    // 1) PATH
    const pathHits = locateOnPath(command);
    // 2)+3) known dirs
    const dirHit = findInDirs(command, searchDirs, exts);
    const candidates = [...new Set([...pathHits, ...(dirHit ? [dirHit] : [])])];

    // Prefer directly-spawnable binaries (.exe / ELF); .cmd/.bat need cmd.exe.
    const sorted = candidates.sort((a, b) => {
      const score = (p: string) => (/\.exe$|\.bat|\.cmd/i.test(p) ? (/\.exe$/i.test(p) ? 0 : 2) : 1);
      return score(a) - score(b);
    });

    for (const candidate of sorted) {
      const isWrapper = /\.(cmd|bat)$/i.test(candidate);
      if (isWrapper) {
        // Verify the wrapper works via its interpreter before trusting it,
        // but remember we cannot spawn it directly.
        const version = runVersion(candidate.replace(/\.cmd|\.bat$/i, '.exe')) ?? null;
        if (!version) continue;
      }
      const version = runVersion(candidate);
      if (!version) continue;
      if (id === 'latexmk') base.command = path.basename(candidate, path.extname(candidate));
      return {
        ...base,
        path: candidate,
        version,
        available: true,
        shellWrapperOnly: isWrapper || undefined,
      };
    }
    if (candidates.some((c) => /\.(cmd|bat)$/i.test(c))) shellWrapperOnly = true;
  }

  return { ...base, shellWrapperOnly: shellWrapperOnly || undefined };
}

export interface DetectionCache {
  env: LatexEnvironment;
  at: number;
}

let cache: DetectionCache | null = null;
const CACHE_TTL_MS = 60_000;

export function detectEnvironment(force = false): LatexEnvironment {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.env;

  const tools = DETECTED_IDS.map(detectTool);
  const engines = tools.filter((t) => ['xelatex', 'pdflatex', 'lualatex'].includes(t.id));
  const latexmk = tools.find((t) => t.id === 'latexmk');

  let distribution: string | undefined;
  for (const t of [...engines, latexmk!]) {
    const v = t.version?.match(/TeX Live (\d{4})|MiKTeX(?: (\d+))?/i)?.[0];
    if (v) {
      distribution = v;
      break;
    }
  }

  const env: LatexEnvironment = {
    tools,
    distribution,
    allAvailable: tools.every((t) => t.available),
    anyAvailable: engines.some((t) => t.available),
    latexmkAvailable: !!latexmk?.available && !latexmk.shellWrapperOnly,
  };
  cache = { env, at: Date.now() };
  return env;
}

/** Resolve which concrete engine to run for a logical compiler choice. */
export function resolveCompilerChoice(
  choice: string,
  env: LatexEnvironment
): { compiler: 'latexmk' | 'xelatex' | 'pdflatex' | 'lualatex'; notice?: string } | null {
  const engineAvailable = (id: string) =>
    env.tools.some((t) => t.id === id && t.available && !t.shellWrapperOnly);

  if (choice === 'auto') {
    if (env.latexmkAvailable) return { compiler: 'latexmk' };
    for (const e of ['xelatex', 'pdflatex', 'lualatex']) {
      if (engineAvailable(e)) {
        return { compiler: e as 'xelatex', notice: `latexmk unavailable — using direct compiler mode (${e})` };
      }
    }
    return null;
  }

  if (choice === 'latexmk') {
    if (env.latexmkAvailable) return { compiler: 'latexmk' };
    for (const e of ['xelatex', 'pdflatex', 'lualatex']) {
      if (engineAvailable(e)) {
        return { compiler: e as 'xelatex', notice: `latexmk unavailable — using direct compiler mode (${e})` };
      }
    }
    return null;
  }

  return engineAvailable(choice) ? { compiler: choice as 'xelatex' } : null;
}
