import { defineConfig } from 'vitest/config';

// Needs a real PostgreSQL (see README). Files share one database, so they run one at a time.
export default defineConfig({
  test: {
    include: ['test/**/*.{test,spec}.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
