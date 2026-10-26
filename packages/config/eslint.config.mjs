import js from '@eslint/js';
import css from '@eslint/css';
import { resolve } from 'node:path';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

import { rawCssSelectors, rawHtmlSelectors, rawStyleSelectors } from './ui-lint.mjs';

// Brief P6/P22: cấm `any` trong packages/* và apps/api/src/modules/*.
const strictAnyFiles = [
  'packages/*/**/*.{ts,tsx,mts,cts}',
  'apps/api/src/modules/**/*.{ts,tsx,mts,cts}',
];

// A selector of the conversation-write rule below, with its one message.
const only = (selector) => ({
  selector,
  message:
    'Only ConversationStateMachine changes conversations, through packages/db/src/conversation-store.ts.',
});
// CLAUDE.md rule 4, below. The admin block repeats them: a later config replaces no-restricted-syntax, it does not add to it.
const conversationWrites = [
  only("CallExpression[callee.property.name='update'][arguments.0.name='conversations']"),
  only(String.raw`TemplateElement[value.raw=/UPDATE\s+(public\.)?conversations\b/i]`),
  only(String.raw`Literal[value=/UPDATE\s+(public\.)?conversations\b/i]`),
];

// The two groups of the no-restricted-imports rule: each one is allowed in one place only (turned off for that place below).
const dbImports = {
  group: ['pg', 'pg/*', 'postgres', 'drizzle-orm', 'drizzle-orm/*'],
  message: 'Chỉ import client DB trong packages/db (qua TenantTx).',
};
const queueImports = {
  group: ['bullmq', 'bullmq/*', 'ioredis', 'ioredis/*'],
  message: 'Chỉ import bullmq/ioredis trong apps/worker/src/queue/ (cổng QueuePublisher).',
};
const banImports = (...patterns) => ['error', { patterns }];
// The JavaScript and TypeScript configs below; the stylesheets of apps/ get their own language (@eslint/css) at the end.
const code = ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'apps/admin/src/api/schema.d.ts', // generated from docs/openapi/openapi.json
    ],
  },
  { files: code, extends: [js.configs.recommended] },
  // Luật cần thông tin kiểu (no-floating-promises, no-misused-promises, no-unsafe-*): chỉ cho file TS.
  // Cố ý KHÔNG bật consistent-type-imports (ép `import type`, làm mất metadata DI của NestJS)
  // và no-extraneous-class (module NestJS là class rỗng).
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    ignores: ['**/*.d.mts'], // khai báo kiểu cho file .mjs, không nằm trong tsconfig nào
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: resolve(import.meta.dirname, '../..'),
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}', '**/*.d.mts'],
    extends: [tseslint.configs.recommended, tseslint.configs.disableTypeChecked],
  },
  {
    files: code,
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // ADR-002: mọi truy vấn đi qua TenantTx trong packages/db.
      'no-restricted-imports': banImports(dbImports, queueImports),
    },
  },
  { files: strictAnyFiles, rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  { files: ['packages/db/**'], rules: { 'no-restricted-imports': banImports(queueImports) } },
  {
    files: ['apps/worker/src/**'],
    rules: { 'no-restricted-imports': banImports(dbImports, queueImports) },
  },
  {
    files: ['apps/worker/src/queue/**'],
    rules: { 'no-restricted-imports': banImports(dbImports) },
  },
  // The worker imports @gani/domain and @gani/conversations since they are built to dist (N108, N138); the ban of N61 is gone.
  // The integration tests of the worker use BullMQ and ioredis directly; they still may not touch the database client.
  { files: ['apps/worker/test/**'], rules: { 'no-restricted-imports': banImports(dbImports) } },
  // The Valkey link of the API's Socket.IO (N144): the one file of apps/api that opens an ioredis connection.
  {
    files: ['apps/api/src/modules/realtime/valkey.ts'],
    rules: { 'no-restricted-imports': banImports(dbImports) },
  },
  // CLAUDE.md rule 4: only the state machine changes the state of a conversation, and it does so through conversation-store.ts.
  // Tests may write test data directly. The scan in packages/db/src/conversation-store-guard.test.ts is the second lock.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    ignores: [
      'packages/db/src/conversation-store.ts',
      'packages/db/test/**',
      '**/*.test.ts',
      '**/*.spec.ts',
    ],
    rules: { 'no-restricted-syntax': ['error', ...conversationWrites] },
  },
  // apps/admin/CLAUDE.md "Cấm": colours and sizes only from packages/ui tokens (ui-lint.mjs); plain text only, never raw HTML (T2).
  {
    files: ['apps/admin/**/*.{ts,tsx,mts,cts}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...conversationWrites,
        ...rawStyleSelectors,
        ...rawHtmlSelectors,
      ],
    },
  },
  {
    files: ['apps/admin/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...rawHtmlSelectors] },
  },
  // The rules of hooks for the admin. @next/eslint-plugin-next is left out: its fast-glob pulls braces 3.0.3, which fails the
  // high-severity audit (GHSA-vfj7-8cjw-p6xm, no patched version).
  {
    files: ['apps/admin/**/*.{ts,tsx,mts,cts}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  // apps/widget/CLAUDE.md: what a customer or a page sends is plain text, never raw HTML; Preact hooks follow the rules of hooks.
  {
    files: ['apps/widget/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts'],
    rules: { 'no-restricted-syntax': ['error', ...conversationWrites, ...rawHtmlSelectors] },
  },
  {
    files: ['apps/widget/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  {
    files: ['apps/**/*.css'],
    language: 'css/css',
    plugins: { css },
    rules: { 'no-restricted-syntax': ['error', ...rawCssSelectors] },
  },
  { files: code, extends: [prettier] },
);
