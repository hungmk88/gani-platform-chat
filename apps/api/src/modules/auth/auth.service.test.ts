import type { createDbPool } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service.js';

const SECRET = 'x'.repeat(32);
const good = {
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: 'https://app.example.test',
  DATABASE_URL_AUTH: 'postgres://auth_role@db/x',
};

describe('AuthService', () => {
  it('stops the start-up, saying what to fix, when a setting is missing or wrong, and never repeats the secret', () => {
    expect(() => AuthService.fromEnv({})).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => AuthService.fromEnv({ ...good, DATABASE_URL_AUTH: undefined })).toThrow(
      /DATABASE_URL_AUTH/,
    );
    expect(() =>
      AuthService.fromEnv({ ...good, BETTER_AUTH_URL: 'http://app.example.test' }),
    ).toThrow(/must be https/);
    expect(() => AuthService.fromEnv({ ...good, BETTER_AUTH_SECRET: 'short' })).not.toThrow(
      /short/,
    );
  });

  it('closes its pool once, however often it is told to stop', async () => {
    const end = vi.fn(() => Promise.resolve());
    const create = vi.fn(() => ({
      query: vi.fn(),
      end,
      on: vi.fn(),
    })) as unknown as typeof createDbPool;
    const env = { secret: SECRET, baseURL: 'https://app.example.test', secureCookies: true };
    const service = new AuthService(env, good.DATABASE_URL_AUTH, create);
    await service.onApplicationShutdown();
    await service.onApplicationShutdown();
    expect(end).toHaveBeenCalledTimes(1);
  });
});
