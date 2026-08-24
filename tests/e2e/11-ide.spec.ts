import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { BASE, tempFixture, openWorkspaceViaApi, openFile, build, hasLatex } from './helpers';

const RUN_REAL = process.env.E2E_HAS_LATEX === '1';

test.describe('11 · project index', () => {
  test('outline + navigator reflect the project', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('multi-file'));

    // Outline tab
    await page.getByRole('tab', { name: 'Outline' }).click();
    await expect(page.getByText('Introduction').first()).toBeVisible({ timeout: 15_000 });

    // Click a section → editor jumps to its file
    await page.getByText('Method', { exact: true }).first().click();
    await expect(page.locator('.monaco-editor')).toBeVisible();

    // Navigator tab lists groups
    await page.getByRole('tab', { name: 'Navigator' }).click();
    await expect(page.getByText('Figures', { exact: true })).toBeVisible();
    await expect(page.getByText('Citations', { exact: true })).toBeVisible();
  });

  test('index diagnostics surface undefined references in Problems', async ({ page }) => {
    await page.goto(BASE);
    const dir = tempFixture('error');
    await openWorkspaceViaApi(page, dir);
    // error fixture has \ref{no:such:label} — the index flags it without a build
    await expect(
      page.getByText(/has no matching .label/i).first()
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('12 · synctex loop (requires LaTeX)', () => {
  test.skip(() => !RUN_REAL, 'SKIPPED: real LaTeX not installed (set E2E_HAS_LATEX=1)');

  test('build → PDF → forward jump lands on mapped page; inverse returns source', async ({
    page,
  }) => {
    await page.goto(BASE);
    const dir = tempFixture('multi-file');
    await openWorkspaceViaApi(page, dir);

    // Build once so we have a buildId + PDF
    await build(page);
    await expect(page.getByText(/Build successful/)).toBeVisible({ timeout: 180_000 });
    const pdfPath = path.join(dir, '.build', 'main.pdf');
    expect(fs.existsSync(pdfPath)).toBe(true);

    // Forward search via API with browser session (cookie present)
    const forward = await page.evaluate(async () => {
      const state = await fetch('/api/workspace/state').then((r) => r.json());
      const latest = await fetch('/api/build/latest').then((r) => r.json());
      const tokenRes = await fetch('/api/auth/token');
      const { token } = await tokenRes.json();
      const res = await fetch(`/api/build/${latest.buildId}/synctex/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-latex-studio-token': token },
        body: JSON.stringify({ file: 'sections/intro.tex', line: 1 }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(forward.status).toBe(200);
    expect(forward.body.page).toBeGreaterThan(0);

    // Inverse search maps back into the workspace (jail-checked)
    const inverse = await page.evaluate(async () => {
      const latest = await fetch('/api/build/latest').then((r) => r.json());
      const tokenRes = await fetch('/api/auth/token');
      const { token } = await tokenRes.json();
      const res = await fetch(`/api/build/${latest.buildId}/synctex/inverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-latex-studio-token': token },
        body: JSON.stringify({ page: 1, x: 100, y: 700 }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(inverse.status).toBe(200);
    expect(inverse.body.file).not.toMatch(/\.\.|^[A-Za-z]:/);
    expect(inverse.body.line).toBeGreaterThan(0);
  });

  test('synctex rejects traversal in forward search', async ({ request }) => {
    const { token } = await (await fetch(`${BASE}/api/auth/token`)).json();
    const ws = tempFixture('basic');
    await request.post('/api/workspace/open', {
      data: { path: ws },
      headers: { 'x-latex-studio-token': token },
    });
    const latest = await request.get('/api/build/latest', {
      headers: { 'x-latex-studio-token': token },
    });
    const buildId = (await latest.json())?.buildId;
    test.skip(!buildId, 'no prior build');
    const res = await request.post(`/api/build/${buildId}/synctex/forward`, {
      data: { file: '../outside.tex', line: 1 },
      headers: { 'x-latex-studio-token': token },
    });
    expect([403, 404]).toContain(res.status());
  });
});
