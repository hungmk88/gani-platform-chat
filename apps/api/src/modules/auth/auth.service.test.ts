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

  describe('activeOrganisationIds', () => {
    const serviceAnswering = (rows: { org_id: string }[]) => {
      const query = vi.fn(() => Promise.resolve({ rows }));
      const create = vi.fn(() => ({
        query,
        end: vi.fn(),
        on: vi.fn(),
      })) as unknown as typeof createDbPool;
      const env = { secret: SECRET, baseURL: 'https://app.example.test', secureCookies: true };
      return { service: new AuthService(env, good.DATABASE_URL_AUTH, create), query };
    };

    it('lists none, one or several organisations in the order the database gave', async () => {
      expect(await serviceAnswering([]).service.activeOrganisationIds('u')).toEqual([]);
      expect(await serviceAnswering([{ org_id: 'a' }]).service.activeOrganisationIds('u')).toEqual([
        'a',
      ]);
      const several = serviceAnswering([{ org_id: 'a' }, { org_id: 'b' }]);
      expect(await several.service.activeOrganisationIds('u')).toEqual(['a', 'b']);
    });

    it('asks for active memberships only, passing the user as a bound parameter', async () => {
      const { service, query } = serviceAnswering([]);
      await service.activeOrganisationIds('person-1');
      const [text, params] = query.mock.calls[0] as unknown as [string, string[]];
      expect(text).toContain('app.memberships_for_user($1)');
      expect(text).toContain("status = 'active'");
      expect(params).toEqual(['person-1']);
    });
  });

  it('renames a person who is still there, and says so', async () => {
    const service = (rowCount: number) => {
      const query = vi.fn(() => Promise.resolve({ rows: [], rowCount }));
      const create = vi.fn(() => ({
        query,
        end: vi.fn(),
        on: vi.fn(),
      })) as unknown as typeof createDbPool;
      const env = { secret: SECRET, baseURL: 'https://app.example.test', secureCookies: true };
      return { service: new AuthService(env, good.DATABASE_URL_AUTH, create), query };
    };
    const live = service(1);
    expect(await live.service.rename('u', 'Lan')).toBe(true);
    expect(live.query).toHaveBeenCalledWith(expect.stringContaining('deleted_at IS NULL'), [
      'u',
      'Lan',
    ]);
    expect(await service(0).service.rename('u', 'Lan')).toBe(false);
  });
});
