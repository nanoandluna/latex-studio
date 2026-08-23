#!/usr/bin/env node
/**
 * Cross-platform env setter so Windows CMD/PowerShell users never need
 * `VAR=1 cmd` syntax.
 *
 * Usage:
 *   node scripts/run-with-env.mjs KEY=VAL [KEY=VAL...] -- <command> [args...]
 */
import { spawnSync } from 'node:child_process';

const sep = process.argv.indexOf('--');
if (sep === -1) {
  console.error('Usage: node run-with-env.mjs KEY=VAL ... -- <command>');
  process.exit(2);
}

const env = { ...process.env };
for (const kv of process.argv.slice(2, sep)) {
  const i = kv.indexOf('=');
  if (i === -1) continue;
  env[kv.slice(0, i)] = kv.slice(i + 1);
}

const [cmd, ...args] = process.argv.slice(sep + 1);
const res = spawnSync(cmd, args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
process.exit(res.status ?? 1);
