import { integrationCoverage } from '@gani/config/vitest';
import { defineConfig } from 'vitest/config';

// Needs a real PostgreSQL (see README). Files share one database, so they run one at a time.
export default defineConfig({
  test: {
    // Measured for the per-file gate of the CI job `coverage` (json only, no threshold): infra/CLAUDE.md "Coverage".
    coverage: integrationCoverage,
    include: ['test/**/*.{test,spec}.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
