import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimOutboxBatch,
  createDbPool,
  failOutboxEvent,
  insertOutboxEvent,
  markOutboxPublished,
  pendingOrgs,
  reapExpiredOutboxClaims,
  requeueDeadLetters,
  withTenant,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The relay's side of the outbox (O-3): app.outbox_pending_orgs, and the store functions that claim, mark, fail, reap and requeue.
// A and B are two organisations with events of their own; D is deleted. Times are offsets from now() so the tests do not sleep.
const [A, B, D] = [uuidv7(), uuidv7(), uuidv7()];
const orgs = [A, B, D];
const users = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;

type Row = { status?: string; due?: string; claimed?: string; attempts?: number; created?: string };
// prettier-ignore
const put = async (org: string, o: Row = {}) => {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO outbox_events (id, org_id, event_type, aggregate_type, aggregate_id, actor_kind, trace_id, status, available_at, claimed_at, published_at, attempts, created_at)
     VALUES ($1, $2, 'e.x', 'conversation', $3, 'system', 't', $4, now() + $5::interval, now() + $6::interval, CASE WHEN $4 = 'published' THEN now() END, $7, now() + $8::interval)`,
    [id, org, uuidv7(), o.status ?? 'pending', o.due ?? '-1 minute', o.claimed ?? null, o.attempts ?? 0, o.created ?? '0'],
  );
  return id;
};
const clear = () => admin.query('DELETE FROM outbox_events WHERE org_id = ANY($1::uuid[])', [orgs]);
const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: A, workspaceIds: [] }, fn);
// prettier-ignore
const row = async (id: string) =>
  (await admin.query<{ status: string; attempts: number; last_error: string | null; claimed_at: Date | null; published_at: Date | null; wait: number }>(
    'SELECT status, attempts, last_error, claimed_at, published_at, extract(epoch FROM available_at - now())::float AS wait FROM outbox_events WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 4 });
  for (const org of orgs) users.set(org, await seedTenant(admin, org));
  await admin.query('UPDATE organizations SET deleted_at = now() WHERE id = $1', [D]);
});
afterAll(async () => {
  await pool.end();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('app.outbox_pending_orgs', () => {
  it('is a SECURITY DEFINER function (not a view), returns only organisation ids, and only app_role may run it', async () => {
    const fn = await admin.query<{ definer: boolean; result: string }>(
      `SELECT prosecdef AS definer, pg_get_function_result(oid) AS result FROM pg_proc WHERE proname = 'outbox_pending_orgs'`,
    );
    expect(fn.rows).toEqual([{ definer: true, result: 'TABLE(org_id uuid)' }]);
    expect(
      (await admin.query(`SELECT 1 FROM pg_views WHERE viewname = 'outbox_pending_orgs'`)).rowCount,
    ).toBe(0);
    const { rows } = await admin.query<{ r: string; ok: boolean }>(
      `SELECT r, has_function_privilege(r, 'app.outbox_pending_orgs(integer, integer)', 'EXECUTE') AS ok FROM unnest(ARRAY['app_role', 'auth_role', 'support_role', 'public']) AS r`,
    );
    expect(rows.filter((x) => x.ok).map((x) => x.r)).toEqual(['app_role']);
  });

  it('names the organisations with a due pending event or an expired claim, oldest work first, without a tenant context', async () => {
    await clear();
    await put(A, { created: '-1 hour' });
    await put(B, { due: '5 minutes' });
    await put(B, { status: 'claimed', claimed: '-5 seconds' });
    await put(B, { status: 'published' });
    await put(D);
    expect(await pendingOrgs(pool, 10, 60)).toEqual([A]);
    await put(B, { status: 'claimed', claimed: '-5 minutes' });
    expect(await pendingOrgs(pool, 10, 60)).toEqual([A, B]);
    expect(await pendingOrgs(pool, 10, 3600)).toEqual([A]);
    expect(await pendingOrgs(pool, 1, 60)).toEqual([A]);
  });

  it.each([
    [0, 60],
    [1001, 60],
    [10, 0],
  ])('refuses limit %i with lease %i (22023)', async (limit, lease) => {
    expect(await sqlState(pendingOrgs(pool, limit, lease))).toBe('22023');
  });
});

describe('claimOutboxBatch', () => {
  it('takes the due events of its own organisation, oldest first, in batches, and counts the attempt', async () => {
    await clear();
    const ids = [
      await put(A, { created: '-5 minutes' }),
      await put(A, { created: '-4 minutes' }),
      await put(A, { created: '-3 minutes' }),
    ];
    await put(A, { due: '10 minutes' });
    await put(A, { status: 'published' });
    await put(B);
    const first = await inA((tx) => claimOutboxBatch(tx, 2));
    expect(first.map((e) => e.id)).toEqual(ids.slice(0, 2));
    expect(first.every((e) => e.orgId === A && e.attempts === 1)).toBe(true);
    expect((await row(ids[0] as string))?.status).toBe('claimed');
    expect((await inA((tx) => claimOutboxBatch(tx, 10))).map((e) => e.id)).toEqual(ids.slice(2));
    expect(await inA((tx) => claimOutboxBatch(tx, 10))).toEqual([]);
  });

  it('gives two relays that ask at once batches that do not overlap (SKIP LOCKED)', async () => {
    await clear();
    const all = new Set<string>();
    for (let i = 0; i < 20; i++) all.add(await put(A));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow = inA(async (tx) => {
      const batch = await claimOutboxBatch(tx, 10);
      await held;
      return batch;
    });
    await new Promise((r) => setTimeout(r, 300));
    const other = await inA((tx) => claimOutboxBatch(tx, 10));
    release();
    const mine = await slow;
    expect(new Set([...mine, ...other].map((e) => e.id))).toEqual(all);
    expect(mine.length + other.length).toBe(20);
  });
});

describe('marking, failing, reaping, requeueing', () => {
  it('publishes only what is claimed', async () => {
    await clear();
    const [claimed, pending] = [
      await put(A, { status: 'claimed', claimed: '0 seconds', attempts: 1 }),
      await put(A),
    ];
    expect(await inA((tx) => markOutboxPublished(tx, [claimed, pending]))).toBe(1);
    expect(await inA((tx) => markOutboxPublished(tx, []))).toBe(0);
    expect(await row(claimed)).toMatchObject({
      status: 'published',
      published_at: expect.any(Date) as Date,
    });
    expect((await row(pending))?.status).toBe('pending');
  });

  it('puts a failure back after the delay, and into dead_letter when the attempts are used up', async () => {
    await clear();
    const [again, last] = [
      await put(A, { status: 'claimed', claimed: '0 seconds', attempts: 2 }),
      await put(A, { status: 'claimed', claimed: '0 seconds', attempts: 5 }),
    ];
    // prettier-ignore
    const fail = (id: string, attempts: number) => inA((tx) => failOutboxEvent(tx, { id, attempts, errorCode: 'E_QUEUE', maxAttempts: 5, retryAfterSeconds: 30 }));
    expect(await fail(again, 2)).toBe('pending');
    expect(await fail(last, 5)).toBe('dead_letter');
    expect(await row(again)).toMatchObject({
      status: 'pending',
      attempts: 2,
      last_error: 'E_QUEUE',
      claimed_at: null,
    });
    expect((await row(again))?.wait).toBeGreaterThan(25);
    expect((await row(last))?.status).toBe('dead_letter');
    expect(await fail(again, 2)).toBeNull();
    expect(await inA((tx) => claimOutboxBatch(tx, 10))).toEqual([]);
  });

  it('takes back an expired claim without counting it twice, and dead-letters one that has no attempts left', async () => {
    await clear();
    const [stale, spent, fresh] = [
      await put(A, { status: 'claimed', claimed: '-5 minutes', attempts: 2 }),
      await put(A, { status: 'claimed', claimed: '-5 minutes', attempts: 5 }),
      await put(A, { status: 'claimed', claimed: '-5 seconds', attempts: 1 }),
    ];
    expect(await inA((tx) => reapExpiredOutboxClaims(tx, 60, 5))).toBe(2);
    expect(await row(stale)).toMatchObject({ status: 'pending', attempts: 2, claimed_at: null });
    expect(await row(spent)).toMatchObject({
      status: 'dead_letter',
      last_error: 'E_LEASE_EXPIRED',
    });
    expect((await row(fresh))?.status).toBe('claimed');
  });

  it('requeues dead letters, all of the organisation or only the ones named', async () => {
    await clear();
    const [x, y, other] = [
      await put(A, { status: 'dead_letter', attempts: 5 }),
      await put(A, { status: 'dead_letter', attempts: 5 }),
      await put(B, { status: 'dead_letter', attempts: 5 }),
    ];
    expect(await inA((tx) => requeueDeadLetters(tx, [x]))).toBe(1);
    expect(await row(x)).toMatchObject({ status: 'pending', attempts: 0, last_error: null });
    expect((await row(y))?.status).toBe('dead_letter');
    expect(await inA((tx) => requeueDeadLetters(tx))).toBe(1);
    expect((await row(other))?.status).toBe('dead_letter');
  });

  // prettier-ignore
  it('leaves no event behind when the transaction that wrote it rolls back (K4)', async () => {
    await clear();
    const event = { id: uuidv7(), workspaceId: null, eventType: 'e.x', aggregateType: 'conversation', aggregateId: uuidv7(), aggregateVersion: 0, payload: {}, actorKind: 'system', actorId: null, traceId: 't' };
    const run = inA(async (tx) => { await insertOutboxEvent(tx, event); throw new Error('later step failed'); });
    await expect(run).rejects.toThrow('later step failed');
    expect((await admin.query('SELECT 1 FROM outbox_events WHERE id = $1', [event.id])).rowCount).toBe(0);
  });
});
