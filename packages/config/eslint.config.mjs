import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// Brief P6/P22: cấm `any` trong packages/* và apps/api/src/modules/*.
const strictAnyFiles = [
  'packages/*/**/*.{ts,tsx,mts,cts}',
  'apps/api/src/modules/**/*.{ts,tsx,mts,cts}',
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // ADR-002: mọi truy vấn đi qua TenantTx trong packages/db.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pg', 'pg/*', 'postgres', 'drizzle-orm', 'drizzle-orm/*'],
              message: 'Chỉ import client DB trong packages/db (qua TenantTx).',
            },
          ],
        },
      ],
    },
  },
  { files: strictAnyFiles, rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  { files: ['packages/db/**'], rules: { 'no-restricted-imports': 'off' } },
  prettier,
);
