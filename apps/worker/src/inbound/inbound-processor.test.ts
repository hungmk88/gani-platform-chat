import type { ClaimedInboundEvent, InboundFailure } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../logger.js';
import { InboundProcessor, inboundErrorCode, type InboundStore } from './inbound-processor.js';
import { InboundLeaseLostError } from './process-event.js';

const settings = {
  pollMs: 20,
  leaseSeconds: 60,
  batchSize: 2,
  maxAttempts: 5,
  orgsPerTick: 10,
  orgParallel: 2,
};

const event = (id: string, workspaceId: string, attempts = 1): ClaimedInboundEvent => ({
  id,
  orgId: 'org',
  workspaceId,
  channelAccountId: 'ca',
  platformMessageId: `m-${id}`,
  eventType: 'user_send_text',
  payload: {},
  receivedAt: new Date(0),
  attempts,
});

// A store over lists of events per workspace, recording the order of what is processed, so the turns of the workspaces can be seen.
function setup(queues: Record<string, ClaimedInboundEvent[]>, process?: InboundStore['process']) {
  const order: string[] = [];
  const logs: string[] = [];
  const failures: InboundFailure[] = [];
  const store = {
    pendingOrgs: vi.fn(() =>
      Promise.resolve(Object.values(queues).some((q) => q.length > 0) ? ['org'] : []),
    ),
    reapExpired: vi.fn(() => Promise.resolve(0)),
    pendingWorkspaces: vi.fn(() =>
      Promise.resolve(Object.keys(queues).filter((ws) => (queues[ws] ?? []).length > 0)),
    ),
    claim: vi.fn((_org: string, ws: string, limit: number) =>
      Promise.resolve((queues[ws] ?? []).splice(0, limit)),
    ),
    process: vi.fn((e: ClaimedInboundEvent) => {
      order.push(e.id);
      return process ? process(e) : Promise.resolve('processed' as const);
    }),
    fail: vi.fn((_org: string, f: InboundFailure) => {
      failures.push(f);
      return Promise.resolve(
        f.attempts >= f.maxAttempts ? ('dead_letter' as const) : ('pending' as const),
      );
    }),
  };
  const log: Logger = {
    info: () => undefined,
    warn: (message, fields) => void logs.push(`${message} ${JSON.stringify(fields ?? {})}`),
    error: (message, fields) => void logs.push(`${message} ${JSON.stringify(fields ?? {})}`),
  };
  const processor = new InboundProcessor({
    store: store satisfies InboundStore,
    log,
    settings,
    shutdownMs: 200,
  });
  return { processor, store, order, logs, failures };
}

describe('InboundProcessor.tick', () => {
  it('reaps first, then gives each workspace a batch in turn, so a flood in one does not hold the other back', async () => {
    const flood = Array.from({ length: 6 }, (_, i) => event(`a${i}`, 'wa'));
    const t = setup({ wa: flood, wb: [event('b0', 'wb')] });
    expect(await t.processor.tick()).toBe(true); // wa gave a full batch: there is more
    expect(t.order).toEqual(['a0', 'a1', 'b0']);
    expect(t.store.reapExpired).toHaveBeenCalledWith('org', 60, 5);
    await t.processor.tick();
    await t.processor.tick();
    expect(await t.processor.tick()).toBe(false);
    expect(t.order).toEqual(['a0', 'a1', 'b0', 'a2', 'a3', 'a4', 'a5']);
  });

  it('only logs a lost claim: the event is not failed, and the next one goes on', async () => {
    const t = setup({ wa: [event('a0', 'wa'), event('a1', 'wa')] }, (e) =>
      e.id === 'a0' ? Promise.reject(new InboundLeaseLostError()) : Promise.resolve('processed'),
    );
    await t.processor.tick();
    expect(t.order).toEqual(['a0', 'a1']);
    expect(t.failures).toEqual([]);
    expect(t.logs).toEqual(['inbound_lease_lost {"orgId":"org","eventId":"a0"}']);
  });

  it('puts a failed event back with a backoff and a code, and sets it aside after the last attempt', async () => {
    const boom = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    const t = setup({ wa: [event('a0', 'wa', 1), event('a1', 'wa', 5)] }, () =>
      Promise.reject(boom),
    );
    await t.processor.tick();
    expect(t.failures).toEqual([
      expect.objectContaining({
        id: 'a0',
        attempts: 1,
        errorCode: 'E_PG_40P01',
        maxAttempts: 5,
        retryAfterSeconds: 2,
      }),
      expect.objectContaining({
        id: 'a1',
        attempts: 5,
        errorCode: 'E_PG_40P01',
        retryAfterSeconds: 32,
      }),
    ]);
    expect(t.logs).toEqual([
      'inbound_failed {"orgId":"org","eventId":"a0","code":"E_PG_40P01"}',
      'inbound_dead_letter {"orgId":"org","eventId":"a1","code":"E_PG_40P01"}',
    ]);
    expect(t.logs.join()).not.toContain('deadlock');
  });

  it('logs an organisation that fails by the name of the error only, and goes on with the others', async () => {
    const t = setup({ wa: [event('a0', 'wa')] });
    t.store.reapExpired.mockRejectedValueOnce(new TypeError('secret detail'));
    expect(await t.processor.tick()).toBe(false);
    expect(t.logs).toEqual(['inbound_org_failed {"orgId":"org","error":"TypeError"}']);
  });
});

describe('inboundErrorCode', () => {
  it.each([
    [{ code: '23505' }, 'E_PG_23505'],
    [{ code: 'version_conflict' }, 'E_VERSION_CONFLICT'],
    [{ code: 'E_SECRET_DECRYPT' }, 'E_SECRET_DECRYPT'],
    [{ code: 'ECONNRESET' }, 'ECONNRESET'],
    [{ code: 'not a code!' }, 'E_PROCESS'],
    [new Error('x'), 'E_PROCESS'],
    ['text', 'E_PROCESS'],
  ])('gives %j the code %s', (error, code) => {
    expect(inboundErrorCode(error)).toBe(code);
  });
});

describe('InboundProcessor start and stop', () => {
  it('processes what arrives while it runs, and stops cleanly', async () => {
    const queues: Record<string, ClaimedInboundEvent[]> = { wa: [] };
    const t = setup(queues);
    t.processor.start();
    expect(() => t.processor.start()).toThrow(/already started/);
    queues['wa']?.push(event('a0', 'wa'));
    await vi.waitFor(() => expect(t.order).toEqual(['a0']));
    expect(await t.processor.stop()).toBe(true);
  });

  it('says false and warns when the pass in progress outlives the deadline', async () => {
    const t = setup({ wa: [event('a0', 'wa')] }, () => new Promise(() => undefined));
    t.processor.start();
    await vi.waitFor(() => expect(t.order).toEqual(['a0']));
    expect(await t.processor.stop()).toBe(false);
    expect(t.logs).toContain('inbound_shutdown_timeout {"shutdownMs":200}');
  });

  it('logs a pass that fails and tries again after the pause', async () => {
    const t = setup({ wa: [] });
    t.store.pendingOrgs.mockRejectedValueOnce(new RangeError('x'));
    t.processor.start();
    await vi.waitFor(() => expect(t.store.pendingOrgs.mock.calls.length).toBeGreaterThan(1));
    expect(t.logs[0]).toBe('inbound_tick_failed {"error":"RangeError"}');
    expect(await t.processor.stop()).toBe(true);
    expect(
      await new InboundProcessor({ store: t.store, log: console, settings, shutdownMs: 1 }).stop(),
    ).toBe(true);
  });
});
