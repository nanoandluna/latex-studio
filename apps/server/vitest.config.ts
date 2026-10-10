import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    // Filesystem benchmarks need an isolated disk/CPU budget. Parallel suites
    // otherwise turn harmless runner contention into timing regressions.
    fileParallelism: false,
  },
});
