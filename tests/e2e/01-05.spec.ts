import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { BASE, FIXTURES, tempFixture, openWorkspaceViaApi, openFile, build, hasLatex } from './helpers';

test.describe('01 · app loads', () => {
  test('title + core regions render', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText('Studio').first()).toBeVisible();
  });
});

test.describe('02 · open workspace', () => {
  test('opens a fixture folder and shows the file tree', async ({ page }) => {
    await page.goto(BASE);
    const dir = tempFixture('basic');
    await page.evaluate(async (d) => {
      await fetch('/api/workspace/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: d }),
      });
    }, dir);
    await page.reload();
    await expect(page.getByText('Explorer')).toBeVisible();
    await expect(page.getByText('main.tex').first()).toBeVisible();
  });

  test('rejects an invalid directory with a structured error', async ({ request }) => {
    const res = await request.post('/api/workspace/open', {
      data: { path: 'Z:/definitely/not/there' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBeTruthy();
  });
});

test.describe('03 · open .tex in editor', () => {
  test('main.tex renders in Monaco with LaTeX content', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('basic'));
    await openFile(page, 'main.tex');
    await expect(page.locator('.view-lines')).toContainText('\\documentclass');
  });
});

test.describe('04 · edit + save', () => {
  test('typing marks the tab dirty; Ctrl+S persists to disk', async ({ page }) => {
    await page.goto(BASE);
    const dir = tempFixture('basic');
    await openWorkspaceViaApi(page, dir);
    await openFile(page, 'main.tex');

    await page.locator('.view-lines').click();
    await page.keyboard.type('% edited-by-e2e');
    await expect(page.locator('button', { hasText: 'main.tex *' }).first()).toBeVisible();

    await page.keyboard.press('Control+s');
    await expect(page.locator('button', { hasText: 'main.tex *' })).toHaveCount(0);

    const onDisk = fs.readFileSync(path.join(dir, 'main.tex'), 'utf8');
    expect(onDisk).toContain('% edited-by-e2e');
  });
});

test.describe('05 · build with missing compiler', () => {
  test('shows a clear unavailable state instead of a fake success', async ({ page }) => {
    test.skip(await hasLatex(), 'LaTeX installed — missing-compiler path not applicable');
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('basic'));
    await openFile(page, 'main.tex');
    await build(page);
    await expect(
      page.getByText(/No LaTeX compiler found|Build failed/).first()
    ).toBeVisible({ timeout: 60_000 });
  });
});
