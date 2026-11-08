import { describe, expect, it } from 'vitest';

import { readSeedEnv, SeedRefusedError } from './seed-sla-demo.js';

// The demo seed runs only where it may write (CLAUDE.md, production lock): development and staging, with both URLs.
const URLS = { DATABASE_URL_MIGRATION: 'postgres://m', DATABASE_URL_APP: 'postgres://a' };
const reason = (env: Record<string, string>) => {
  try {
    readSeedEnv(env);
    return 'ok';
  } catch (e) {
    return e instanceof SeedRefusedError ? e.reason : 'other';
  }
};

describe('readSeedEnv', () => {
  it('takes development and staging with both URLs', () => {
    expect(readSeedEnv({ APP_ENV: 'development', ...URLS })).toEqual({
      migrationUrl: 'postgres://m',
      appUrl: 'postgres://a',
    });
    expect(reason({ APP_ENV: 'staging', ...URLS })).toBe('ok');
  });

  it('refuses production, test, anything else or nothing, before it looks at the URLs', () => {
    for (const APP_ENV of ['production', 'test', 'prod', 'dev', ''])
      expect(reason({ APP_ENV, ...URLS })).toBe('app_env');
    expect(reason({ ...URLS })).toBe('app_env');
  });

  it('refuses a missing URL', () => {
    expect(reason({ APP_ENV: 'development', DATABASE_URL_MIGRATION: 'postgres://m' })).toBe(
      'database_url_missing',
    );
    expect(reason({ APP_ENV: 'development', DATABASE_URL_APP: 'postgres://a' })).toBe(
      'database_url_missing',
    );
  });
});
