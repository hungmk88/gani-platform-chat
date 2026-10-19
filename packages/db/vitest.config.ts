import { coverage } from '@gani/config/vitest';
import { defineConfig } from 'vitest/config';

// Unit tests: no database. Files that only make sense against PostgreSQL (tenant-tx, pool, schema) are covered by
// the integration suite (vitest.integration.config.ts) and left out of the unit coverage gate.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      ...coverage,
      exclude: [
        ...coverage.exclude,
        'src/conversation-lock.ts',
        'src/conversation-store.ts',
        'src/inbound-store.ts',
        'src/message-store.ts',
        'src/outbox-store.ts',
        'src/tenant-tx.ts',
        'src/member-context.ts',
        'src/auth-tx.ts',
        'src/auth-db.ts',
        'src/pool.ts',
        'src/schema/**',
      ],
    },
  },
});
