import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs PostgreSQL: DATABASE_URL_AUTH and DATABASE_URL_MIGRATION (the `db` job of CI sets them). Not part of `pnpm test`.
export default defineConfig({
  // SWC emits the decorator metadata that NestJS dependency injection needs (as in vitest.config.ts).
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
