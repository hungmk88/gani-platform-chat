import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../logger.js';
import { errorCodeOf, type EventJob } from '../relay/job.js';
import {
  BullmqPublisher,
  createBullmqPublisher,
  JOB_OPTIONS,
  QueueDownError,
  throttledErrorLog,
  type JobQueue,
} from './bullmq-publisher.js';

// The queue and the connection are fakes that record what they are asked, so the tests need no server. What the fakes cannot tell
// (how BullMQ answers a duplicate `jobId`) is not tested here: the kill-tests of O-5 do (N98). The tests at the end use the real
// ioredis and the real BullMQ against a port nobody listens on.

const job = (queue: string, id: string, type = 'conversation.state_changed'): EventJob =>
  ({ queue, jobId: id, data: { id, type, orgId: 'org-1' } }) as unknown as EventJob;

interface FakeQueue extends JobQueue {
  readonly name: string;
  readonly added: { name: string; data: unknown; opts: unknown }[][];
  counts: Record<string, number>;
  failAdd: boolean;
  hang: boolean;
  failClose: boolean;
}

function setup(callMs = 1000) {
  const events: string[] = [];
  const warnings: string[] = [];
  const queues = new Map<string, FakeQueue>();
  const emitter = new EventEmitter();
  const connection = Object.assign(emitter, {
    status: 'ready',
    quitFails: false,
    quit: vi.fn((): Promise<unknown> => {
      events.push('quit');
      return connection.quitFails ? Promise.reject(new Error('boom')) : Promise.resolve('OK');
    }),
    disconnect: vi.fn(() => void events.push('disconnect')),
  });
  const makeQueue = vi.fn((name: string): JobQueue => {
    const queue: FakeQueue = {
      name,
      added: [],
      counts: {},
      failAdd: false,
      hang: false,
      failClose: false,
      addBulk(jobs) {
        queue.added.push(jobs);
        if (queue.hang) return new Promise(() => undefined);
        return queue.failAdd ? Promise.reject(new Error('NOSCRIPT')) : Promise.resolve([]);
      },
      // Mirrors queue-getters.js of bullmq 5.81.5: `waiting` is counted together with `paused`, and a type is counted once.
      getJobCountByTypes(...types) {
        const wanted = new Set<string>(types.includes('waiting') ? [...types, 'paused'] : types);
        return Promise.resolve([...wanted].reduce((sum, t) => sum + (queue.counts[t] ?? 0), 0));
      },
      close() {
        events.push(`close ${name}`);
        return queue.failClose ? Promise.reject(new Error('boom')) : Promise.resolve();
      },
    };
    queues.set(name, queue);
    return queue;
  });
  const log: Logger = {
    info: () => undefined,
    warn: (message) => void warnings.push(message),
    error: () => undefined,
  };
  const publisher = new BullmqPublisher({
    connection,
    makeQueue,
    log,
    callMs,
  });
  return { publisher, connection, makeQueue, queues, events, warnings };
}

describe('publish', () => {
  // prettier-ignore
  it('adds each job with the id of the event as the job id, the type as the name, and the retry and retention options', async () => {
    const t = setup();
    await t.publisher.publish([job('q.events.ws.ws-1', 'e-1', 'message.created')]);
    expect(t.queues.get('q.events.ws.ws-1')?.added).toEqual([
      [{ name: 'message.created', data: { id: 'e-1', type: 'message.created', orgId: 'org-1' }, opts: {
        attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: { age: 3600, count: 10000 },
        removeOnFail: { age: 604800, count: 1000 }, jobId: 'e-1',
      } }],
    ]);
    expect(JOB_OPTIONS.attempts).toBe(5);
  });

  it('adds the jobs of one queue in one call and makes one queue for each name, once', async () => {
    const t = setup();
    await t.publisher.publish([job('qa', 'e-1'), job('qb', 'e-2'), job('qa', 'e-3')]);
    await t.publisher.publish([job('qa', 'e-4')]);
    expect(t.makeQueue).toHaveBeenCalledTimes(2);
    expect(t.queues.get('qa')?.added.map((call) => call.map((j) => j.opts))).toEqual([
      [expect.objectContaining({ jobId: 'e-1' }), expect.objectContaining({ jobId: 'e-3' })],
      [expect.objectContaining({ jobId: 'e-4' })],
    ]);
    expect(t.queues.get('qb')?.added).toHaveLength(1);
  });

  it('reports no duplicates: BullMQ does not tell a job it already has from a new one', async () => {
    expect(await setup().publisher.publish([job('qa', 'e-1')])).toEqual({ duplicates: [] });
  });

  it('rejects when one queue refuses, so the relay puts the whole batch back; the others were still tried', async () => {
    const t = setup();
    await t.publisher.publish([job('qb', 'e-0')]);
    const qb = t.queues.get('qb');
    if (!qb) throw new Error('queue missing');
    qb.failAdd = true;
    await expect(t.publisher.publish([job('qa', 'e-1'), job('qb', 'e-2')])).rejects.toThrow(
      'NOSCRIPT',
    );
    expect(t.queues.get('qa')?.added).toHaveLength(1);
  });

  it('says the queue is down when a call gets no answer in time', async () => {
    const t = setup(20);
    await t.publisher.publish([job('qa', 'e-0')]);
    const qa = t.queues.get('qa');
    if (!qa) throw new Error('queue missing');
    qa.hang = true;
    const error: unknown = await t.publisher.publish([job('qa', 'e-1')]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueueDownError);
    expect(errorCodeOf(error)).toBe('E_QUEUE_DOWN');
  });
});

describe('waiting', () => {
  it('counts waiting, paused and prioritized jobs, and none of the others', async () => {
    const t = setup();
    await t.publisher.publish([job('qa', 'e-0')]);
    const qa = t.queues.get('qa');
    if (!qa) throw new Error('queue missing');
    qa.counts = {
      waiting: 3,
      paused: 2,
      prioritized: 4,
      active: 100,
      delayed: 100,
      completed: 100,
      failed: 100,
    };
    expect(await t.publisher.waiting('qa')).toBe(9);
  });
});

describe('the connection', () => {
  it('waits for a connection that is coming up, and stops listening once it is up', async () => {
    const t = setup();
    t.connection.status = 'connecting';
    const done = t.publisher.publish([job('qa', 'e-1')]);
    expect(t.connection.listenerCount('ready')).toBe(1);
    t.connection.status = 'ready';
    t.connection.emit('ready');
    await done;
    expect(t.queues.get('qa')?.added).toHaveLength(1);
    expect(t.connection.listenerCount('ready')).toBe(0);
  });

  it('says the queue is down, and touches no queue, when the connection does not come up', async () => {
    const t = setup(20);
    t.connection.status = 'reconnecting';
    const error: unknown = await t.publisher.publish([job('qa', 'e-1')]).catch((e: unknown) => e);
    expect(errorCodeOf(error)).toBe('E_QUEUE_DOWN');
    await expect(t.publisher.waiting('qa')).rejects.toBeInstanceOf(QueueDownError);
    expect(t.makeQueue).not.toHaveBeenCalled();
    expect(t.connection.listenerCount('ready')).toBe(0);
  });
});

describe('close', () => {
  it('closes every queue, then the connection they share', async () => {
    const t = setup();
    await t.publisher.publish([job('qa', 'e-1'), job('qb', 'e-2')]);
    await t.publisher.close();
    expect(t.events).toEqual(['close qa', 'close qb', 'quit']);
  });

  it('closes once however many times it is called, and publishes nothing afterwards', async () => {
    const t = setup();
    await t.publisher.publish([job('qa', 'e-1')]);
    await Promise.all([t.publisher.close(), t.publisher.close()]);
    await t.publisher.close();
    expect(t.events).toEqual(['close qa', 'quit']);
    await expect(t.publisher.publish([job('qa', 'e-2')])).rejects.toBeInstanceOf(QueueDownError);
  });

  it('still closes the connection when a queue does not close, and disconnects when it does not quit', async () => {
    const t = setup();
    await t.publisher.publish([job('qa', 'e-1'), job('qb', 'e-2')]);
    const qa = t.queues.get('qa');
    if (!qa) throw new Error('queue missing');
    qa.failClose = true;
    t.connection.quitFails = true;
    await t.publisher.close();
    expect(t.events).toEqual(['close qa', 'close qb', 'quit', 'disconnect']);
    expect(t.warnings).toEqual(['queue_close_failed', 'queue_quit_failed']);
  });
});

describe('throttledErrorLog', () => {
  it('logs the code of an error, at most once in 30 seconds, and never the message', () => {
    const lines: [string, unknown][] = [];
    const log: Logger = {
      info: () => undefined,
      error: () => undefined,
      warn: (m, f) => void lines.push([m, f]),
    };
    let now = 1_000_000;
    const onError = throttledErrorLog(log, () => now);
    onError(
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:6379'), { code: 'ECONNREFUSED' }),
    );
    now += 29_999;
    onError(new Error('again'));
    now += 1;
    onError('no code');
    expect(lines).toEqual([
      ['queue_connection_error', { code: 'ECONNREFUSED' }],
      ['queue_connection_error', { code: null }],
    ]);
  });
});

// Against a real ioredis and a real BullMQ, with nothing listening: what the fakes above only claim.
describe('with no server', () => {
  async function closedPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    await new Promise((resolve) => server.close(resolve));
    return port;
  }

  it('gives the codes ioredis really raises, and errorCodeOf reads them as the queue being down', async () => {
    const port = await closedPort();
    const connection = new Redis({
      host: '127.0.0.1',
      port,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    const refused = new Promise<unknown>((resolve) => connection.once('error', resolve));
    const commandError: unknown = await connection.ping().catch((e: unknown) => e);
    const connectError = await refused;
    expect(errorCodeOf(commandError)).toBe('E_QUEUE_DOWN');
    expect(errorCodeOf(connectError)).toBe('E_QUEUE_DOWN');
    expect(connectError).toMatchObject({ code: 'ECONNREFUSED' });
    connection.disconnect();
  });

  it('fails a publish and a count in time instead of waiting for ever, and still closes', async () => {
    const port = await closedPort();
    const connection = new Redis({
      host: '127.0.0.1',
      port,
      enableOfflineQueue: false,
      retryStrategy: () => 50,
    });
    let errors = 0;
    connection.on('error', () => void errors++);
    const queues: Queue[] = [];
    const publisher = new BullmqPublisher({
      connection,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      makeQueue: (name) => {
        const queue = new Queue(name, { connection });
        queue.on('error', () => undefined);
        queues.push(queue);
        return queue;
      },
      callMs: 300,
    });
    const started = Date.now();
    const error: unknown = await publisher.publish([job('qa', 'e-1')]).catch((e: unknown) => e);
    expect(errorCodeOf(error)).toBe('E_QUEUE_DOWN');
    await expect(publisher.waiting('qa')).rejects.toBeInstanceOf(QueueDownError);
    expect(queues).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(3000);
    await publisher.close();
    // ioredis leaves the status at `reconnecting` after a disconnect from that state (checked), so look for the attempts instead.
    const errorsAtClose = errors;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(errors).toBe(errorsAtClose);
  });

  it('builds the real publisher from an address, which logs a refused connection by its code', async () => {
    const port = await closedPort();
    const warnings: [string, unknown][] = [];
    const publisher = createBullmqPublisher(`redis://127.0.0.1:${port}`, {
      info: () => undefined,
      error: () => undefined,
      warn: (m, f) => void warnings.push([m, f]),
    });
    await vi.waitFor(() =>
      expect(warnings[0]).toEqual(['queue_connection_error', { code: 'ECONNREFUSED' }]),
    );
    await publisher.close();
  });
});
