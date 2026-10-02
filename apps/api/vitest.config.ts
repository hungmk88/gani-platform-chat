import { coverage } from '@gani/config/vitest';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC emits decorator metadata (design:paramtypes) that NestJS dependency injection needs.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
    coverage,
  },
});
