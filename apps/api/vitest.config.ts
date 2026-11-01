import { coverage } from '@gani/config/vitest';
import swc from 'unplugin-swc';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC emits decorator metadata (design:paramtypes) that NestJS dependency injection needs.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
    // Integration tests need PostgreSQL: pnpm test:integration.
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
    // Files that only make sense against PostgreSQL (a controller of the Inbox, the Idempotency-Key interceptor) are covered by the
    // integration suite (vitest.integration.config.ts) and left out of the unit coverage gate, as in packages/db.
    coverage: {
      ...coverage,
      exclude: [
        ...coverage.exclude,
        'src/modules/conversations/conversations.controller.ts',
        'src/modules/conversations/conversation-actions.controller.ts',
        'src/modules/idempotency/idempotency.interceptor.ts',
        'src/modules/auth/invitations.ts',
        'src/modules/auth/password-reset.ts',
        'src/modules/members/members.controller.ts',
        'src/modules/members/members.module.ts',
        'src/modules/workspaces/workspaces.controller.ts',
        'src/modules/teams/teams.controller.ts',
        'src/modules/channels/channels.controller.ts',
        'src/modules/quick-replies/quick-replies.controller.ts',
        'src/modules/customers/customers.controller.ts',
        'src/modules/audit/audit.controller.ts',
        'src/modules/bot-flows/bot-flows.controller.ts',
      ],
    },
  },
});
