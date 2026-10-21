import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { PermanentEventError } from '../consumer/event-consumer.js';
import { EVENT_QUEUE_REGISTRY } from './bullmq-publisher.js';
import { BullmqSource } from './bullmq-source.js';

// The connection and the workers are fakes; the real BullMQ runs against Valkey in test/bullmq-source.spec.ts.
function setup(callMs = 1000) {
  const events: string[] = [];
  const runs = new Map<string, (data: unknown) => Promise<void>>();
  const connection = {
    members: ['q.a'],
    quitFails: false,
    smembers: vi.fn((key: string): Promise<string[]> => {
      events.push(`smembers ${key}`);
      return Promise.resolve(connection.members);
    }),
    quit: vi.fn(() => {
      events.push('quit');
      return connection.quitFails ? Promise.reject(new Error('x')) : Promise.resolve('OK');
    }),
    disconnect: vi.fn(() => void events.push('disconnect')),
  };
  const workerClose = vi.fn((name: string) => {
    events.push(`close ${name}`);
    return name === 'bad' ? Promise.reject(new Error('x')) : Promise.resolve();
  });
  const warnings: string[] = [];
  const source = new BullmqSource({
    connection,
    callMs,
    log: { info: () => undefined, warn: (m) => void warnings.push(m), error: () => undefined },
    makeWorker: (queue, run) => {
      runs.set(queue, run);
      return { close: () => workerClose(queue) };
    },
  });
  return { source, connection, runs, events, warnings };
}

describe('BullmqSource', () => {
  it('reads the registry the publisher writes', async () => {
    const t = setup();
    expect(await t.source.queues()).toEqual(['q.a']);
    expect(t.events).toEqual([`smembers ${EVENT_QUEUE_REGISTRY}`]);
  });

  it('gives up on a registry that does not answer in time', async () => {
    const t = setup(20);
    t.connection.smembers.mockReturnValueOnce(new Promise(() => undefined));
    await expect(t.source.queues()).rejects.toThrow(/in time/);
  });

  it('makes a permanent failure unrecoverable for BullMQ, and passes any other error on as it is', async () => {
    const t = setup();
    const boom = new Error('again');
    await t.source.subscribe('q.a', (data) =>
      data === 'bad'
        ? Promise.reject(new PermanentEventError('E_TENANT_MISSING'))
        : Promise.reject(boom),
    );
    const run = t.runs.get('q.a');
    if (!run) throw new Error('no worker');
    const permanent: unknown = await run('bad').catch((e: unknown) => e);
    expect(permanent).toBeInstanceOf(UnrecoverableError);
    expect((permanent as Error).message).toBe('E_TENANT_MISSING');
    await expect(run('other')).rejects.toBe(boom);
  });

  it('closes every worker, then the connection, once; and subscribes to nothing afterwards', async () => {
    const t = setup();
    await t.source.subscribe('q.a', () => Promise.resolve());
    await t.source.subscribe('bad', () => Promise.resolve());
    t.connection.quitFails = true;
    await Promise.all([t.source.close(), t.source.close()]);
    expect(t.events).toEqual(['close q.a', 'close bad', 'quit', 'disconnect']);
    expect(t.warnings).toEqual(['event_worker_close_failed', 'event_source_quit_failed']);
    await expect(t.source.subscribe('q.b', () => Promise.resolve())).rejects.toThrow(/closed/);
  });
});
