import { currentTenantContext } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../logger.js';
import { EventConsumer, PermanentEventError, type QueueSource } from './event-consumer.js';
import { loggingHandlers } from './handlers.js';

const ORG = '0197a3c0-0000-7000-8000-000000000001';
const WS = '0197a3c0-0000-7000-8000-000000000002';
const wsQueue = `q.events.ws.${WS}`;
const orgQueue = `q.events.org.${ORG}`;
const event = (over: Record<string, unknown> = {}) => ({
  id: 'e-1',
  type: 'message.created',
  orgId: ORG,
  workspaceId: WS,
  payload: { body: 'never logged' },
  ...over,
});

// The source is a fake that records what is subscribed and hands back the job function, so a test can run a job by hand.
function setup(names: string[], settings = { discoveryMs: 10, maxQueues: 10 }) {
  const logs: string[] = [];
  const jobs = new Map<string, (data: unknown) => Promise<void>>();
  const source = {
    queues: vi.fn(() => Promise.resolve([...names])),
    subscribe: vi.fn((name: string, handle: (data: unknown) => Promise<void>) => {
      jobs.set(name, handle);
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  const line = (message: string, fields?: object) =>
    void logs.push(`${message} ${JSON.stringify(fields ?? {})}`);
  const log: Logger = { info: line, warn: line, error: line };
  const consumer = new EventConsumer({
    source: source satisfies QueueSource,
    handlers: loggingHandlers(log),
    log,
    settings,
    shutdownMs: 200,
  });
  return { consumer, source, jobs, logs };
}

describe('EventConsumer.discover', () => {
  it('subscribes once to each event queue of the registry, and passes over a name it does not make', async () => {
    const t = setup([wsQueue, orgQueue, 'q.test.x', `q.events.ws.${WS}x`]);
    await t.consumer.discover();
    await t.consumer.discover();
    expect([...t.jobs.keys()]).toEqual([wsQueue, orgQueue]);
    expect(t.source.subscribe).toHaveBeenCalledTimes(2);
    expect(t.logs.filter((l) => l.startsWith('event_queue_unknown'))).toHaveLength(2);
  });

  it('takes no more queues than its cap, and warns once for each one left', async () => {
    const t = setup([wsQueue, orgQueue], { discoveryMs: 10, maxQueues: 1 });
    await t.consumer.discover();
    await t.consumer.discover();
    expect([...t.jobs.keys()]).toEqual([wsQueue]);
    expect(t.logs.filter((l) => l.startsWith('event_queues_full'))).toEqual([
      `event_queues_full {"queue":"${orgQueue}","max":1}`,
    ]);
  });
});

describe('EventConsumer.handle', () => {
  it('runs the handler of the type in the tenant of the event, and logs its ids only', async () => {
    const t = setup([]);
    const seen: unknown[] = [];
    const record = () => {
      seen.push(currentTenantContext());
      return Promise.resolve();
    };
    const consumer = new EventConsumer({
      source: t.source,
      handlers: { 'message.created': record },
      log: console,
      settings: { discoveryMs: 1, maxQueues: 1 },
      shutdownMs: 1,
    });
    await consumer.handle(event());
    expect(seen).toEqual([{ orgId: ORG, workspaceIds: [WS] }]);
    await t.consumer.handle(event());
    expect(t.logs).toEqual([
      `event_consumed {"eventId":"e-1","type":"message.created","orgId":"${ORG}","workspaceId":"${WS}"}`,
    ]);
  });

  it('is done with a type no handler wants', async () => {
    const t = setup([]);
    await t.consumer.handle(event({ type: 'conversation.manager_alert' }));
    expect(t.logs).toEqual([
      'event_unhandled {"eventId":"e-1","type":"conversation.manager_alert"}',
    ]);
  });

  it('fails for good, without running a handler, a job without a tenant or that is not an event', async () => {
    const t = setup([]);
    for (const bad of [
      event({ orgId: undefined }),
      event({ orgId: '' }),
      event({ workspaceId: 7 }),
    ])
      await expect(t.consumer.handle(bad)).rejects.toEqual(
        new PermanentEventError('E_TENANT_MISSING'),
      );
    for (const bad of [null, 'x', event({ id: '' }), event({ type: 3 })])
      await expect(t.consumer.handle(bad)).rejects.toMatchObject({
        permanent: true,
        code: 'E_NOT_AN_EVENT',
      });
    expect(t.logs).toEqual(
      Array(3).fill('event_tenant_missing {"eventId":"e-1","type":"message.created"}'),
    );
  });

  it('lets a handler that throws be retried, and logs the name of its error only', async () => {
    const t = setup([]);
    const boom = new TypeError('detail of the customer');
    const consumer = new EventConsumer({
      source: t.source,
      handlers: { 'message.created': () => Promise.reject(boom) },
      log: {
        info: () => undefined,
        warn: (m, f) => void t.logs.push(`${m} ${JSON.stringify(f)}`),
        error: () => undefined,
      },
      settings: { discoveryMs: 1, maxQueues: 1 },
      shutdownMs: 1,
    });
    await expect(consumer.handle(event())).rejects.toBe(boom);
    expect(t.logs).toEqual([
      'event_handler_failed {"eventId":"e-1","type":"message.created","error":"TypeError"}',
    ]);
  });
});

describe('EventConsumer start and stop', () => {
  it('finds the queues that come while it runs, then stops and closes the source', async () => {
    const names: string[] = [];
    const t = setup(names);
    t.source.queues.mockImplementation(() => Promise.resolve([...names]));
    t.consumer.start();
    expect(() => t.consumer.start()).toThrow(/already started/);
    names.push(wsQueue);
    await vi.waitFor(() => expect(t.jobs.has(wsQueue)).toBe(true));
    expect(await t.consumer.stop()).toBe(true);
    expect(t.source.close).toHaveBeenCalledOnce();
  });

  it('logs a registry that does not answer and tries again', async () => {
    const t = setup([wsQueue]);
    t.source.queues.mockRejectedValueOnce(new RangeError('x'));
    t.consumer.start();
    await vi.waitFor(() => expect(t.jobs.has(wsQueue)).toBe(true));
    expect(t.logs[0]).toBe('event_discovery_failed {"error":"RangeError"}');
    expect(await t.consumer.stop()).toBe(true);
  });

  it('says false and warns when the source does not close in time', async () => {
    const t = setup([]);
    t.source.close.mockReturnValue(new Promise(() => undefined));
    expect(await t.consumer.stop()).toBe(false);
    expect(t.logs).toContain('event_consumer_shutdown_timeout {"shutdownMs":200}');
  });
});
