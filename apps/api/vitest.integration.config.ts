import { defineConfig } from 'vitest/config';

// Needs PostgreSQL: DATABASE_URL_AUTH and DATABASE_URL_MIGRATION (the `db` job of CI sets them). Not part of `pnpm test`.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
