import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const BASE = process.env.BASE_URL ?? 'http://localhost:3210';
// Playwright's TS transform does not support import.meta — anchor on CWD (repo root).
const repoRoot = process.cwd();
export const FIXTURES = process.env.FIXTURES_DIR ?? path.join(repoRoot, 'tests', 'fixtures');

/** Copy a fixture to a temp dir so tests never mutate the originals. */
export function tempFixture(name: string): string {
  const src = path.join(FIXTURES, name);
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `lstudio-e2e-${name}-`)), name);
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

export async function openWorkspaceViaApi(page: import('@playwright/test').Page, dir: string) {
  await page.evaluate(async (d) => {
    const res = await fetch('/api/workspace/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: d }),
    });
    if (!res.ok) throw new Error(await res.text());
  }, dir);
  // Wait until the app has restored workspace state (incl. mainFile) before
  // returning — otherwise an immediate Ctrl+B can run against an empty store.
  const stateReady = page.waitForResponse((r) => r.url().includes('/api/workspace/state'), { timeout: 30_000 }).catch(() => null);
  await page.reload();
  await stateReady;
}

export async function openFile(page: import('@playwright/test').Page, fileName: string) {
  await page.getByText(fileName).first().dblclick();
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
}

export async function build(page: import('@playwright/test').Page) {
  await page.keyboard.press('Control+b');
}

/** Instance-session token for out-of-browser API calls (see server security.ts). */
export async function apiToken(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/token`);
  if (!res.ok) throw new Error(`token bootstrap failed: ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

/**
 * Whether a real LaTeX compiler is available for this run.
 * Real-build specs skip loudly when it is not.
 */
export async function hasLatex(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/env`, {
      headers: { 'x-latex-studio-token': await apiToken() },
    });
    const env = (await res.json()) as { anyAvailable: boolean };
    return !!env.anyAvailable;
  } catch {
    return false;
  }
}
