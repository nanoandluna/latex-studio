import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The server holds ONE global workspace — tests must run serially.
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3210',
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: 'pnpm --filter @latex-studio/server start',
        url: 'http://localhost:3210/api/health',
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
