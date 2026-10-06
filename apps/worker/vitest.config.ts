import { coverage } from '@gani/config/vitest';
import { defineConfig } from 'vitest/config';

// The worker is plain Node (no decorators), so unlike apps/api it needs no SWC plugin and its tests run anywhere.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage,
  },
});
