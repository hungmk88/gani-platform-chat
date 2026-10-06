import { defineConfig } from 'vitest/config';

// Needs a real Valkey (REDIS_URL, VALKEY_CONTAINER): the `queue` job of CI sets them. Not part of `pnpm test`; the files share one
// Valkey and some stop it, so they run one at a time. No retry: a red run is read, not repeated (outbox spec §10).
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    fileParallelism: false,
    retry: 0,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
