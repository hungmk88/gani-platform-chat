import type { ClaimedOutboxEvent } from '@gani/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerConfig } from '../config.js';
import type { LogFields, Logger } from '../logger.js';
import { WorkerMetrics } from '../metrics.js';
import { backoffSeconds } from './job.js';
import { OutboxRelay, type QueuePublisher, type RelayStore } from './outbox-relay.js';

// The relay against a store that behaves like the real one (claim counts an attempt, fail dead-letters at the limit) and a queue that
// can refuse. Timers are fake, so the loop and the shutdown are tested without waiting.
type Settings = WorkerConfig['outbox'];
const SETTINGS: Settings = {
  pollMs: 10,
  leaseSeconds: 60,
  batchSize: 3,
  maxAttempts: 5,
  orgsPerTick: 50,
  orgParallel: 2,
  shutdownMs: 1000,
  queueMaxWaiting: 100,
};

// prettier-ignore
const event = (id: string, orgId: string, workspaceId: string | null = 'ws-1'): ClaimedOutboxEvent => ({
  id, orgId, workspaceId, eventType: 'conversation.state_changed', eventVersion: 1, aggregateType: 'conversation', aggregateId: 'c-1',
  aggregateVersion: 1, payload: {}, actorKind: 'bot', actorId: null, traceId: 't', occurredAt: new Date('2026-10-06T00:00:00Z'), attempts: 0,
});

type Status = 'pending' | 'claimed' | 'published' | 'dead_letter';
// prettier-ignore
function world(events: ClaimedOutboxEvent[]) {
  const rows = new Map<string, { e: ClaimedOutboxEvent; status: Status; attempts: number }>(events.map((e) => [e.id, { e, status: 'pending', attempts: 0 }]));
  const calls: string[] = [];
  const failures: { id: string; attempts: number; errorCode: string; maxAttempts: number; retryAfterSeconds: number }[] = [];
  const hooks = { claimError: new Set<string>(), markLoses: 0, active: 0, peak: 0 };
  const pendingOf = (org: string) => [...rows.values()].filter((r) => r.e.orgId === org && r.status === 'pending');
  const store: RelayStore = {
    pendingOrgs: (limit) => (calls.push('orgs'), Promise.resolve([...new Set([...rows.values()].filter((r) => r.status === 'pending').map((r) => r.e.orgId))].slice(0, limit))),
    reapExpired: (org, lease, max) => (calls.push(`reap:${org}:${lease}:${max}`), Promise.resolve(0)),
    claim: async (org, limit) => {
      calls.push(`claim:${org}`);
      hooks.peak = Math.max(hooks.peak, ++hooks.active);
      await Promise.resolve();
      await Promise.resolve();
      hooks.active--;
      if (hooks.claimError.has(org)) throw new Error('database down');
      return pendingOf(org).slice(0, limit).map((r) => ((r.status = 'claimed'), { ...r.e, attempts: ++r.attempts }));
    },
    markPublished: (org, ids) => {
      calls.push(`mark:${org}`);
      const done = ids.slice(0, Math.max(ids.length - hooks.markLoses, 0));
      for (const id of done) (rows.get(id) as { status: Status }).status = 'published';
      return Promise.resolve(done.length);
    },
    fail: (_org, f) => {
      failures.push(f);
      const row = rows.get(f.id);
      if (!row || row.status !== 'claimed') return Promise.resolve(null);
      row.status = f.attempts >= f.maxAttempts ? 'dead_letter' : 'pending';
      return Promise.resolve(row.status);
    },
  };
  return { store, rows, calls, failures, hooks, status: (id: string) => rows.get(id)?.status };
}

// prettier-ignore
function harness(events: ClaimedOutboxEvent[], settings: Partial<Settings> = {}) {
  const w = world(events);
  const logs: { level: string; message: string; fields: LogFields }[] = [];
  const log: Logger = { info: (m, f = {}) => void logs.push({ level: 'info', message: m, fields: f }), warn: (m, f = {}) => void logs.push({ level: 'warn', message: m, fields: f }), error: (m, f = {}) => void logs.push({ level: 'error', message: m, fields: f }) };
  const q = { published: [] as Parameters<QueuePublisher['publish']>[0][number][], waiting: new Map<string, number>(), duplicates: [] as string[], fail: null as Error | null, waitingFail: null as Error | null, gate: null as Promise<void> | null };
  const queue: QueuePublisher = {
    waiting: (name) => (q.waitingFail ? Promise.reject(q.waitingFail) : Promise.resolve(q.waiting.get(name) ?? 0)),
    publish: async (jobs) => {
      w.calls.push('publish');
      await q.gate;
      if (q.fail) throw q.fail;
      q.published.push(...jobs);
      return { duplicates: q.duplicates };
    },
  };
  const metrics = new WorkerMetrics();
  const relay = new OutboxRelay({ store: w.store, queue, log, settings: { ...SETTINGS, ...settings }, metrics });
  // The value of one series of /metrics (OPS-02).
  const count = (name: string) => Number(new RegExp(`^${name} (\\S+)$`, 'm').exec(metrics.render())?.[1]);
  return { ...w, q, logs, relay, count, seen: (message: string) => logs.filter((l) => l.message === message) };
}

describe('one pass of the relay', () => {
  it('reaps, claims, publishes and marks, in that order, with the id of the event as the job id', async () => {
    const h = harness([event('e1', 'A'), event('e2', 'A', null)]);
    expect(await h.relay.tick()).toBe(false);
    expect(h.calls).toEqual(['orgs', 'reap:A:60:5', 'claim:A', 'publish', 'mark:A']);
    expect(h.q.published.map((j) => [j.jobId, j.queue])).toEqual([
      ['e1', 'q.events.ws.ws-1'],
      ['e2', 'q.events.org.A'],
    ]);
    expect([h.status('e1'), h.status('e2')]).toEqual(['published', 'published']);
  });

  it('does not touch the queue when no organisation has work', async () => {
    const h = harness([]);
    await h.relay.tick();
    expect(h.calls).toEqual(['orgs']);
  });

  it('puts a refused event back after the backoff, and dead-letters it at the fifth attempt', async () => {
    const h = harness([event('e1', 'A')]);
    h.q.fail = Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:6379'), {
      code: 'ECONNREFUSED',
    });
    for (let attempt = 1; attempt <= 4; attempt++) {
      await h.relay.tick();
      expect(h.status('e1')).toBe('pending');
    }
    await h.relay.tick();
    expect(h.status('e1')).toBe('dead_letter');
    expect(
      h.failures.map((f) => [f.attempts, f.retryAfterSeconds, f.errorCode, f.maxAttempts]),
    ).toEqual([1, 2, 3, 4, 5].map((n) => [n, backoffSeconds(n), 'E_QUEUE_DOWN', 5]));
    expect(h.seen('dead_letter')).toEqual([
      {
        level: 'error',
        message: 'dead_letter',
        fields: { orgId: 'A', eventId: 'e1', code: 'E_QUEUE_DOWN' },
      },
    ]);
    expect(JSON.stringify(h.logs)).not.toContain('10.0.0.9');
    expect([
      h.count('outbox_publish_failures_total'),
      h.count('outbox_dead_lettered_total'),
    ]).toEqual([5, 1]);
  });

  it('goes on with the other organisations when one fails', async () => {
    const h = harness([event('a1', 'A'), event('b1', 'B')]);
    h.hooks.claimError.add('A');
    await h.relay.tick();
    expect(h.status('b1')).toBe('published');
    expect(h.seen('relay_org_failed')).toEqual([
      { level: 'error', message: 'relay_org_failed', fields: { orgId: 'A', error: 'Error' } },
    ]);
  });

  it('counts a job the queue already had as published, and says so', async () => {
    const h = harness([event('e1', 'A')]);
    h.q.duplicates = ['e1'];
    await h.relay.tick();
    expect(h.status('e1')).toBe('published');
    expect(h.seen('duplicate_jobs')[0]?.fields).toEqual({ orgId: 'A', count: 1 });
  });

  it('warns when a claim was taken back before it could be marked', async () => {
    const h = harness([event('e1', 'A'), event('e2', 'A')]);
    h.hooks.markLoses = 1;
    await h.relay.tick();
    expect(h.seen('lease_lost')[0]?.fields).toEqual({ orgId: 'A', count: 1 });
  });

  it('asks again at once after a full batch, not after a partial one', async () => {
    expect(await harness([event('1', 'A'), event('2', 'A'), event('3', 'A')]).relay.tick()).toBe(
      true,
    );
    expect(await harness([event('1', 'A'), event('2', 'A')]).relay.tick()).toBe(false);
  });

  it('keeps at most orgParallel organisations in flight', async () => {
    const h = harness(['A', 'B', 'C', 'D', 'E'].map((org) => event(`e-${org}`, org)));
    await h.relay.tick();
    expect(h.hooks.peak).toBe(2);
    expect(h.rows.size).toBe(5);
  });
});

describe('backpressure', () => {
  it('skips an organisation whose queue is full, serves the others, and resumes when it drains', async () => {
    const h = harness([event('a1', 'A'), event('b1', 'B', 'ws-2')], { queueMaxWaiting: 5 });
    await h.relay.tick();
    const [a2, b2] = [event('a2', 'A'), event('b2', 'B', 'ws-2')];
    h.rows.set('a2', { e: a2, status: 'pending', attempts: 0 });
    h.rows.set('b2', { e: b2, status: 'pending', attempts: 0 });
    h.q.waiting.set('q.events.ws.ws-1', 5);
    await h.relay.tick();
    expect([h.status('a2'), h.status('b2')]).toEqual(['pending', 'published']);
    expect(h.seen('queue_full')).toEqual([
      {
        level: 'warn',
        message: 'queue_full',
        fields: { orgId: 'A', queue: 'q.events.ws.ws-1', waiting: 5, max: 5 },
      },
    ]);
    h.q.waiting.set('q.events.ws.ws-1', 4);
    await h.relay.tick();
    expect(h.status('a2')).toBe('published');
    expect(h.count('outbox_queue_full_total')).toBe(1);
  });
});

describe('a queue that cannot be asked', () => {
  it('skips the organisations it knows the queue of, with a warning, claims nothing and uses no attempt, and resumes when it answers', async () => {
    const h = harness([event('a1', 'A'), event('b1', 'B', 'ws-2')]);
    await h.relay.tick();
    for (const [id, org, ws] of [
      ['a2', 'A', 'ws-1'],
      ['b2', 'B', 'ws-2'],
    ] as const)
      h.rows.set(id, { e: event(id, org, ws), status: 'pending', attempts: 0 });
    h.calls.length = 0;
    h.q.waitingFail = Object.assign(new Error('the queue did not answer in time'), {
      code: 'E_QUEUE_DOWN',
    });
    expect(await h.relay.tick()).toBe(false);
    expect(h.calls.filter((c) => c.startsWith('claim') || c === 'publish')).toEqual([]);
    expect([h.rows.get('a2'), h.rows.get('b2')].map((r) => [r?.status, r?.attempts])).toEqual([
      ['pending', 0],
      ['pending', 0],
    ]);
    expect(h.seen('relay_org_failed')).toEqual([]);
    expect(h.seen('queue_unreachable').map((l) => [l.level, l.fields])).toEqual([
      ['warn', { orgId: 'A', queue: 'q.events.ws.ws-1', code: 'E_QUEUE_DOWN' }],
      ['warn', { orgId: 'B', queue: 'q.events.ws.ws-2', code: 'E_QUEUE_DOWN' }],
    ]);
    expect(h.count('outbox_queue_full_total')).toBe(2);
    h.q.waitingFail = null;
    await h.relay.tick();
    expect([h.status('a2'), h.status('b2')]).toEqual(['published', 'published']);
  });
});

describe('the loop and the shutdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pauses pollMs when idle, drains without pausing while batches are full, and stops at once in a pause', async () => {
    const h = harness(Array.from({ length: 7 }, (_, i) => event(`e${i}`, 'A')));
    h.relay.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.q.published).toHaveLength(7);
    expect(h.calls.filter((c) => c === 'orgs')).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(h.calls.filter((c) => c === 'orgs')).toHaveLength(4);
    expect(await h.relay.stop()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.calls.filter((c) => c === 'orgs')).toHaveLength(4);
  });

  it('waits for the pass in progress, then starts no other', async () => {
    const h = harness([event('e1', 'A')]);
    let release!: () => void;
    h.q.gate = new Promise<void>((resolve) => (release = resolve));
    h.relay.start();
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const stopping = h.relay.stop().then((clean) => ((stopped = true), clean));
    await vi.advanceTimersByTimeAsync(100);
    expect(stopped).toBe(false);
    release();
    expect(await stopping).toBe(true);
    expect(h.status('e1')).toBe('published');
    expect(h.calls.filter((c) => c === 'orgs')).toHaveLength(1);
  });

  it('reports a shutdown that takes longer than shutdownMs', async () => {
    const h = harness([event('e1', 'A')]);
    h.q.gate = new Promise<void>(() => undefined);
    h.relay.start();
    await vi.advanceTimersByTimeAsync(0);
    const stopping = h.relay.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await stopping).toBe(false);
    expect(h.seen('shutdown_timeout')[0]?.fields).toEqual({ shutdownMs: 1000 });
  });

  it('survives a pass that throws, logs it, and tries again after the pause', async () => {
    const h = harness([event('e1', 'A')]);
    const orgs = vi.spyOn(h.store, 'pendingOrgs').mockRejectedValueOnce(new Error('db down'));
    h.relay.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.seen('relay_tick_failed')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(orgs).toHaveBeenCalledTimes(2);
    expect(h.status('e1')).toBe('published');
    await h.relay.stop();
    // A failed pass still ends a pass: the loop is alive, only the database is not.
    expect(h.count('outbox_relay_failed_passes_total')).toBe(1);
    expect(h.count('outbox_relay_passes_total')).toBeGreaterThanOrEqual(2);
  });

  it('cannot be started twice, and stopping a relay that never started is clean', async () => {
    const h = harness([]);
    expect(await h.relay.stop()).toBe(true);
    const other = harness([]);
    other.relay.start();
    expect(() => other.relay.start()).toThrowError(/already started/);
    await other.relay.stop();
  });
});
