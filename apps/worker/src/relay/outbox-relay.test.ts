import type { ClaimedOutboxEvent } from '@gani/db';
import { describe, expect, it } from 'vitest';

import type { WorkerConfig } from '../config.js';
import type { LogFields, Logger } from '../logger.js';
import { backoffSeconds } from './job.js';
import { OutboxRelay, type QueuePublisher, type RelayStore } from './outbox-relay.js';

// The relay against a store that behaves like the real one (claim counts an attempt, fail dead-letters at the limit) and a queue that
// can refuse.
type Settings = WorkerConfig['outbox'];
const SETTINGS: Settings = {
  pollMs: 10,
  leaseSeconds: 60,
  batchSize: 3,
  maxAttempts: 5,
  orgsPerTick: 50,
  orgParallel: 2,
  shutdownMs: 1000,
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
  const q = { published: [] as Parameters<QueuePublisher['publish']>[0][number][], duplicates: [] as string[], fail: null as Error | null };
  const queue: QueuePublisher = {
    publish: (jobs) => {
      w.calls.push('publish');
      if (q.fail) return Promise.reject(q.fail);
      q.published.push(...jobs);
      return Promise.resolve({ duplicates: q.duplicates });
    },
  };
  const relay = new OutboxRelay({ store: w.store, queue, log, settings: { ...SETTINGS, ...settings } });
  return { ...w, q, logs, relay, seen: (message: string) => logs.filter((l) => l.message === message) };
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
