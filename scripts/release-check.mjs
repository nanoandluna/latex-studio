#!/usr/bin/env node
/**
 * LaTeX Studio V0.1.0 Release Gate.
 *
 * Usage: pnpm release:check
 *
 * Steps (all must pass for READY):
 *   1. doctor            environment probe (exit 1 if no TeX engine)
 *   2. typecheck         tsc across all packages
 *   3. test              unit + integration (no LaTeX required)
 *   4. real latex tests  RUN_LATEX_TESTS=1 — BLOCKED counts as failure
 *   5. real e2e          E2E_HAS_LATEX=1 playwright
 *   6. build             web + server production builds
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(label, cmd, args, env = {}) {
  process.stdout.write(`\n▶ ${label}: ${cmd} ${args.join(' ')}\n`);
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  return res.status === 0;
}

const results = [];

const step = (name, ok) => {
  results.push([name, ok]);
};

step('Doctor', run('Doctor', 'pnpm', ['doctor']));
step('Typecheck', run('Typecheck', 'pnpm', ['-r', 'typecheck']));
step('Unit/Integration', run('Tests (unit/integration)', 'pnpm', ['-r', 'test']));
step(
  'Real LaTeX',
  run(
    'Real LaTeX tests',
    'node',
    ['scripts/run-with-env.mjs', 'RUN_LATEX_TESTS=1', '--', 'pnpm', '--filter', '@latex-studio/server', 'test'],
    { RUN_LATEX_TESTS: '1' }
  )
);
step(
  'Real E2E',
  run(
    'Real E2E',
    'node',
    [
      'scripts/run-with-env.mjs',
      'E2E_HAS_LATEX=1',
      '--',
      'pnpm',
      'exec',
      'playwright',
      'test',
      '-c',
      'tests/playwright.config.ts',
    ],
    { E2E_HAS_LATEX: '1' }
  )
);
step('Web Build', run('Web Build', 'pnpm', ['--filter', '@latex-studio/web', 'build']));
step('Server Build', run('Server Build', 'pnpm', ['--filter', '@latex-studio/server', 'build']));

const width = Math.max(...results.map(([n]) => n.length));
console.log('\n────────────────────────────');
console.log('LaTeX Studio Release Gate');
console.log('────────────────────────────');
for (const [name, ok] of results) {
  console.log(`${name.padEnd(width + 4)}${ok ? 'PASS' : 'FAIL'}`);
}
const allOk = results.every(([, ok]) => ok);
console.log('\nRESULT:');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
console.log(allOk ? `READY FOR v${version}` : 'NOT READY');
process.exit(allOk ? 0 : 1);
