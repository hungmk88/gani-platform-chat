import { coverage } from '@gani/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: { ...coverage, include: ['src/brand.ts'] },
  },
});
