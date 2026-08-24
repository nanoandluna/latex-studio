#!/usr/bin/env node
/**
 * LaTeX Studio Doctor — official Release Gate environment probe.
 *
 * Usage:
 *   pnpm doctor            human-readable report
 *   pnpm doctor --json     machine-readable (for CI)
 *
 * Exit codes: 0 = core environment READY, 1 = NOT READY.
 * Core requirement: at least one TeX engine (XeLaTeX preferred) reachable.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const JSON_MODE = process.argv.includes('--json');
const isWin = process.platform === 'win32';

// ---------------------------------------------------------------------------
function locateOnPath(command) {
  const res = spawnSync(isWin ? 'where.exe' : 'which', [command], {
    shell: false,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  if (res.status !== 0 || !res.stdout) return [];
  return res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function commonBinDirs() {
  const dirs = [];
  if (isWin) {
    for (const d of fs.readdirSync('/').filter((x) => /^[C-Z]:$/.test(x))) {
      const tl = path.join(`${d}\\`, 'texlive');
      if (fs.existsSync(tl)) {
        for (const year of fs.readdirSync(tl).sort().reverse()) {
          for (const bin of ['bin\\windows', 'bin\\win32']) {
            const p = path.join(tl, year, bin);
            if (fs.existsSync(p)) dirs.push(p);
          }
        }
      }
      for (const rel of [
        'Program Files\\MiKTeX\\miktex\\bin\\x64',
        'Program Files (x86)\\MiKTeX\\miktex\\bin',
        'Users\\Public\\Programs\\MiKTeX\\miktex\\bin\\x64',
      ]) {
        const p = path.join(`${d}\\`, rel);
        if (fs.existsSync(p)) dirs.push(p);
      }
    }
    if (process.env.LOCALAPPDATA) {
      const p = path.join(process.env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64');
      if (fs.existsSync(p)) dirs.push(p);
    }
    // Strawberry Perl (needed by latexmk on Windows)
    const sp = `${process.env.SYSTEMDRIVE || 'C:'}\\Strawberry\\perl\\bin`;
    if (fs.existsSync(sp)) dirs.push(sp);
  } else if (process.platform === 'darwin') {
    dirs.push('/Library/TeX/texbin', '/usr/local/bin');
  } else {
    dirs.push('/usr/local/bin', '/usr/bin');
    const tl = '/usr/local/texlive';
    if (fs.existsSync(tl)) {
      for (const year of fs.readdirSync(tl).sort().reverse()) {
        const binRoot = path.join(tl, year, 'bin');
        if (fs.existsSync(binRoot)) {
          for (const arch of fs.readdirSync(binRoot)) dirs.push(path.join(binRoot, arch));
        }
      }
    }
  }
  if (process.env.LATEX_STUDIO_EXTRA_PATH) {
    dirs.push(...process.env.LATEX_STUDIO_EXTRA_PATH.split(path.delimiter));
  }
  try {
    const cfg = path.join(os.homedir(), '.latex-studio.json');
    if (fs.existsSync(cfg)) {
      const parsed = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      if (Array.isArray(parsed.extraPaths)) dirs.push(...parsed.extraPaths);
    }
  } catch {
    /* ignore malformed config */
  }
  return dirs.filter((d) => d && fs.existsSync(d));
}

function runVersion(cmd, timeoutMs = 15000) {
  let res;
  try {
    // latexmk needs Perl; make sure any located Perl bin dir is on PATH.
    const childPath = [...foundDirs.filter((d) => /perl/i.test(d)), process.env.PATH]
      .join(path.delimiter);
    res = spawnSync(cmd, ['--version'], {
      shell: false,
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      env: { ...process.env, PATH: childPath },
    });
  } catch {
    return null;
  }
  if (!res || res.error || (res.status !== 0 && !res.stdout)) return null;
  const all = `${res.stdout ?? ''}${res.stderr ?? ''}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line =
    all.find((l) => /latexmk|version\s+\d|\bv?\d+\.\d+/i.test(l) && !/^initial win/i.test(l)) ?? all[0];
  return line ? line.slice(0, 120) : null;
}

const foundDirs = commonBinDirs();

function findTool(id, aliases = []) {
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  const names = [id, ...aliases];
  const candidates = [];
  for (const name of names) {
    candidates.push(...locateOnPath(name));
    for (const dir of foundDirs) {
      for (const ext of exts) {
        const p = path.join(dir, name + ext);
        if (fs.existsSync(p)) candidates.push(p);
      }
    }
  }
  const unique = [...new Set(candidates)].sort((a, b) => {
    const score = (p) => (/\.exe$/i.test(p) ? 0 : /\.(cmd|bat)$/i.test(p) ? 2 : 1);
    return score(a) - score(b);
  });
  for (const c of unique) {
    const v = runVersion(c);
    if (v) return { path: c, version: v };
  }
  return null;
}

// ---------------------------------------------------------------------------
const tools = {
  xelatex: findTool('xelatex'),
  pdflatex: findTool('pdflatex'),
  lualatex: findTool('lualatex'),
  latexmk: findTool('latexmk', isWin ? ['miktex-latexmk'] : []),
  bibtex: findTool('bibtex'),
  biber: findTool('biber'),
  synctex: findTool('synctex'),
};

let distribution;
for (const t of Object.values(tools)) {
  const m = t?.version?.match(/TeX Live (\d{4})|MiKTeX(?: (\d+))?/i);
  if (m) {
    distribution = m[0];
    break;
  }
}

const enginesOk = ['xelatex', 'pdflatex', 'lualatex'].some((k) => !!tools[k]);
// Core release gate: a real engine; latexmk recommended but not blocking.
const ready = enginesOk;

const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures');
const fixturesOk =
  fs.existsSync(fixturesDir) &&
  ['basic', 'chinese', 'multi-file', 'bibliography', 'bibliography-biber', 'multi-file-bib', 'image', 'error', 'unicode-path', 'beamer'].every(
    (f) => fs.existsSync(path.join(fixturesDir, f))
  );

let buildDirOk = false;
try {
  const probe = path.join(os.tmpdir(), `latex-studio-doctor-${Date.now()}`);
  fs.mkdirSync(probe, { recursive: true });
  fs.rmSync(probe, { recursive: true, force: true });
  buildDirOk = true;
} catch {
  buildDirOk = false;
}

const report = {
  ready,
  platform: process.platform,
  arch: process.arch,
  node: { available: true, version: process.version },
  pnpm: locateOnPath('pnpm')[0] ?? null,
  latex: {
    distribution: distribution ?? null,
    xelatex: !!tools.xelatex,
    pdflatex: !!tools.pdflatex,
    lualatex: !!tools.lualatex,
    latexmk: !!tools.latexmk && !!runVersion(tools.latexmk.path),
    bibtex: !!tools.bibtex,
    biber: !!tools.biber,
    synctex: !!tools.synctex,
    paths: Object.fromEntries(Object.entries(tools).map(([k, v]) => [k, v?.path ?? null])),
  },
  project: {
    fixtures: fixturesOk,
    buildDirectoryWritable: buildDirOk,
  },
};

if (JSON_MODE) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(ready ? 0 : 1);
}

// --- human output -----------------------------------------------------------
const mark = (ok) => (ok ? '✓' : '✕');
const lines = [];
lines.push('LaTeX Studio Doctor');
lines.push('────────────────────────────────');
lines.push('');
lines.push('System');
lines.push(`  OS               ${mark(true)} ${process.platform} (${os.release()})`);
lines.push(`  Architecture     ${mark(true)} ${process.arch}`);
lines.push(`  Node.js          ${mark(true)} ${process.version.replace(/^v/, '')}`);
const pnpmHit = locateOnPath('pnpm')[0];
lines.push(`  pnpm             ${mark(!!pnpmHit)} ${pnpmHit ?? 'not found'}`);
lines.push('');
lines.push('LaTeX Environment');
lines.push(`  TeX Distribution ${distribution ? mark(true) : '·'} ${distribution ?? 'unknown'}`);
lines.push('');

const toolLine = (label, key, optional = false) => {
  const t = tools[key];
  const detail = t ? `${t.path}${t.version ? ` · ${t.version}` : ''}` : optional ? 'not found (optional)' : 'NOT FOUND';
  lines.push(`  ${label.padEnd(16)} ${mark(!!t)} ${detail}`);
};

toolLine('XeLaTeX', 'xelatex');
toolLine('pdfLaTeX', 'pdflatex');
toolLine('LuaLaTeX', 'lualatex');
toolLine('latexmk', 'latexmk');
lines.push('');
lines.push('Optional (per-fixture)');
toolLine('BibTeX', 'bibtex', true);
toolLine('Biber', 'biber', true);
toolLine('SyncTeX', 'synctex', true);
lines.push('');
lines.push('Project');
lines.push(`  Test Fixtures    ${mark(fixturesOk)} ${fixturesOk ? fixturesDir : 'tests/fixtures incomplete'}`);
lines.push(`  Build Directory  ${mark(buildDirOk)} ${buildDirOk ? 'temp dirs writable' : 'cannot create temp directories'}`);
lines.push('');
lines.push('Release Gate');
lines.push(`  Environment      ${mark(enginesOk)} ${enginesOk ? 'TeX engine available' : 'no TeX engine'}`);
lines.push(`  Real Compiler    ${mark(ready)} ${ready ? 'compilation possible' : 'compilation impossible'}`);
lines.push('');
lines.push(`Overall            ${ready ? 'READY' : 'NOT READY'}`);

if (!ready) {
  lines.push('');
  lines.push('Install TeX Live (https://tug.org/texlive) or MiKTeX (https://miktex.org),');
  lines.push('then verify in a NEW terminal:');
  lines.push('  xelatex --version');
  lines.push('  latexmk --version');
  lines.push('Optional user paths: set LATEX_STUDIO_EXTRA_PATH=<dirs> or ~/.latex-studio.json {"extraPaths":[…]}');
}

console.log(lines.join('\n'));
process.exit(ready ? 0 : 1);
