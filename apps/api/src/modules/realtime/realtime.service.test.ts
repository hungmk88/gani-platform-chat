import { createServer } from 'node:http';

import { Logger, type LoggerService } from '@nestjs/common';
import { Adapter } from 'socket.io-adapter';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RealtimeService } from './realtime.service.js';

// The Valkey path of attach (N144). The integration tests of the API run without REDIS_URL, so only the in-memory path runs there; the
// Valkey path runs in the job `queue` through dist/main.js, which coverage cannot see. A fake link stands for createValkeyLink: what is
// checked is what the server ends up with (its adapter, its readiness answer, its log), not which function was called.
class FakeValkeyAdapter extends Adapter {}
const link = { answer: false, closed: false };
vi.mock('./valkey.js', () => ({
  createValkeyLink: () => ({
    adapter: FakeValkeyAdapter,
    ping: () => Promise.resolve(link.answer),
    close: () => {
      link.closed = true;
      return Promise.resolve();
    },
  }),
}));

const lines: string[] = [];
const keep = (message: unknown) => void lines.push(String(message));
const collect: LoggerService = { log: keep, warn: keep, error: keep };

function attached(adapter: { url: string } | { memory: true }) {
  Logger.overrideLogger(collect);
  const service = new RealtimeService();
  service.attach(createServer(), { adapter } as never);
  return service;
}

afterEach(() => {
  lines.length = 0;
  Object.assign(link, { answer: false, closed: false });
});

// The class of the adapter is compared: printing a whole adapter on a failure runs out of memory.
describe('RealtimeService.attach', () => {
  it('with REDIS_URL: the namespace runs on the Valkey adapter, and nothing says realtime is in memory', async () => {
    const service = attached({ url: 'redis://cache:6379' });
    expect(service.agent?.adapter.constructor).toBe(FakeValkeyAdapter);
    expect(lines.join('\n')).not.toContain('REDIS_URL is not set');
    await service.beforeApplicationShutdown();
    expect(link.closed).toBe(true);
  });

  it('without it: the in-memory adapter, and the log says the worker cannot reach these sockets', async () => {
    const service = attached({ memory: true });
    expect(service.agent?.adapter.constructor).toBe(Adapter);
    expect(lines).toContain(
      'REDIS_URL is not set: realtime runs in memory, the worker cannot reach these sockets',
    );
    await service.beforeApplicationShutdown();
  });
});

describe('RealtimeService.ping', () => {
  it('answers what Valkey answers on the Valkey adapter, and true in memory', async () => {
    const valkey = attached({ url: 'redis://cache:6379' });
    expect(await valkey.ping()).toBe(false);
    link.answer = true;
    expect(await valkey.ping()).toBe(true);
    const memory = attached({ memory: true });
    expect(await memory.ping()).toBe(true);
    await Promise.all([valkey.beforeApplicationShutdown(), memory.beforeApplicationShutdown()]);
  });
});
