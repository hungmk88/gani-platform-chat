import { createServer } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { createValkeyLink, realtimeAdapterPolicy } from './valkey.js';

describe('realtimeAdapterPolicy', () => {
  it('takes Valkey when REDIS_URL is set, whatever the environment', () => {
    expect(
      realtimeAdapterPolicy({ REDIS_URL: ' redis://cache:6379 ', APP_ENV: 'production' }),
    ).toEqual({
      url: 'redis://cache:6379',
    });
  });

  it('refuses to start a production API without REDIS_URL, naming the variable and nothing else', () => {
    for (const blank of [undefined, '', '  '])
      expect(() => realtimeAdapterPolicy({ REDIS_URL: blank, APP_ENV: 'production' })).toThrowError(
        /^REDIS_URL is not set/,
      );
  });

  it('runs in memory in development and test', () => {
    for (const env of ['development', 'test', undefined])
      expect(realtimeAdapterPolicy({ APP_ENV: env })).toEqual({ memory: true });
  });
});

describe('createValkeyLink', () => {
  // A port that accepts nothing: the real ioredis keeps trying, so PING never answers and the check must give up by itself.
  it('answers false in time when Valkey does not answer, logs a code without the address, and still closes', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const warn = vi.fn();
    const link = createValkeyLink(`redis://:secret@127.0.0.1:${port}`, { warn }, 100);
    expect(await link.ping()).toBe(false);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls.flat().join()).toMatch(/valkey connection error \(ECONNREFUSED\)/);
    expect(warn.mock.calls.flat().join()).not.toContain('secret');
    await expect(link.close()).resolves.toBeUndefined();
  });
});
