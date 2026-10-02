import type { createDbPool } from '@gani/db';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DatabaseService } from './database.service.js';

type Create = typeof createDbPool;
type Options = Parameters<Create>[1];

/** A pool stub plus the arguments `create` was called with. */
function fakePool(query: () => Promise<unknown>) {
  const end = vi.fn(() => Promise.resolve());
  const create = vi.fn<(url: string, options?: Options) => unknown>(() => ({ query, end }));
  return { create: create as unknown as Create, calls: create.mock.calls, end };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DatabaseService', () => {
  it.each([undefined, ''])(
    'creates no pool and reports "down" without DATABASE_URL_APP (%j)',
    async (url) => {
      const { create, calls } = fakePool(() => Promise.resolve());
      const service = new DatabaseService(url, create);
      expect(await service.ping()).toBe(false);
      expect(calls).toHaveLength(0);
      await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    },
  );

  it('pings through the pool it created from the URL', async () => {
    const { create, calls } = fakePool(() => Promise.resolve({ rows: [] }));
    const service = new DatabaseService('postgres://app_role@db/x', create);
    expect(await service.ping()).toBe(true);
    expect(calls[0]?.[0]).toBe('postgres://app_role@db/x');
  });

  it('reports "down" when the database refuses', async () => {
    const { create } = fakePool(() => Promise.reject(new Error('connection refused')));
    expect(await new DatabaseService('postgres://x', create).ping()).toBe(false);
  });

  it('closes the pool once, however often shutdown is called', async () => {
    const { create, end } = fakePool(() => Promise.resolve());
    const service = new DatabaseService('postgres://x', create);
    await service.onApplicationShutdown();
    await service.onApplicationShutdown();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('logs only the error code of an idle pool error, never its message', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { create, calls } = fakePool(() => Promise.resolve());
    new DatabaseService('postgres://x', create);
    const onError = calls[0]?.[1]?.onError;
    onError?.(Object.assign(new Error('password for user app_role failed'), { code: '57P01' }));
    onError?.(new Error('no code here'));
    expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
      'database pool error (57P01)',
      'database pool error (unknown)',
    ]);
  });
});
