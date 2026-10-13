import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimInboundBatch,
  createDbPool,
  insertIfAbsent,
  markInboundIgnored,
  markInboundProcessed,
  pendingInboundWorkspaces,
  withTenant,
  type NewInboundEvent,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The inbound store (N106): record an event once, list the workspaces with work, claim a batch, and mark it.
// Org A has workspaces WA and WA2 (an account in each); B is a stranger. The tests that need two transactions at once (the key, the
// claim) use two pooled connections and are the ones PGlite cannot run. Times are offsets from now(), so nothing sleeps.
const [A, B, WA2, CA2] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const orgs = [A, B];
const users = new Map<string, string>();
let [WA, WB, CA, CB] = ['', '', '', ''];
let admin: pg.Client;
let pool: pg.Pool;

const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: A, workspaceIds: [] }, fn);
const inB = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: B, workspaceIds: [] }, fn);
const newEvent = (over: Partial<NewInboundEvent> = {}): NewInboundEvent => ({
  id: uuidv7(),
  workspaceId: WA,
  channelAccountId: CA,
  platformMessageId: `m-${uuidv7()}`,
  eventType: 'user_send_text',
  payload: { text: 'hello' },
  ...over,
});

interface Row {
  org?: string;
  workspace?: string;
  channel?: string;
  status?: string;
  /** available_at, as an offset from now(). */
  due?: string;
  /** received_at, as an offset from now(). */
  received?: string;
}
// prettier-ignore
const put = async (o: Row = {}) => {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO inbound_events (id, org_id, workspace_id, channel_account_id, platform_message_id, event_type, payload, received_at, status, available_at, claimed_at, processed_at, last_error)
     VALUES ($1, $2, $3, $4, $5, 't', '{}', now() + $6::interval, $7, now() + $8::interval,
       CASE WHEN $7 = 'claimed' THEN now() END, CASE WHEN $7 IN ('processed', 'ignored') THEN now() END, CASE WHEN $7 IN ('ignored', 'dead_letter') THEN 'E_X' END)`,
    [id, o.org ?? A, o.workspace ?? WA, o.channel ?? CA, `m-${id}`, o.received ?? '0', o.status ?? 'pending', o.due ?? '-1 minute'],
  );
  return id;
};
const clear = async () => {
  await admin.query('DELETE FROM inbound_events WHERE org_id = ANY($1::uuid[])', [orgs]);
  await admin.query('DELETE FROM inbound_event_keys WHERE org_id = ANY($1::uuid[])', [orgs]);
};
const count = async (table: string, messageId?: string) =>
  (
    await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE org_id = ANY($1::uuid[]) AND ($2::text IS NULL OR platform_message_id = $2)`,
      [orgs, messageId ?? null],
    )
  ).rows[0]?.n;
const row = async (id: string) =>
  (
    await admin.query<{
      status: string;
      attempts: number;
      last_error: string | null;
      claimed: boolean;
      done: boolean;
    }>(
      'SELECT status, attempts, last_error, claimed_at IS NOT NULL AS claimed, processed_at IS NOT NULL AS done FROM inbound_events WHERE id = $1',
      [id],
    )
  ).rows[0];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 4 });
  for (const org of orgs) users.set(org, await seedTenant(admin, org));
  const one = async (sql: string, org: string) =>
    ((await admin.query<{ id: string }>(sql, [org])).rows[0] as { id: string }).id;
  WA = await one('SELECT id FROM workspaces WHERE org_id = $1', A);
  WB = await one('SELECT id FROM workspaces WHERE org_id = $1', B);
  CA = await one('SELECT id FROM channel_accounts WHERE org_id = $1', A);
  CB = await one('SELECT id FROM channel_accounts WHERE org_id = $1', B);
  await admin.query(
    "INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')",
    [WA2, A],
  );
  await admin.query(
    "INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name) VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA2')",
    [CA2, A, WA2, `oa-${CA2}`],
  );
});

afterAll(async () => {
  await pool.end();
  await clear();
  await admin.query('DELETE FROM channel_accounts WHERE id = $1', [CA2]);
  await admin.query('DELETE FROM workspaces WHERE id = $1', [WA2]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('insertIfAbsent', () => {
  it('writes the event and its key, in the organisation of the context, with the defaults of the table', async () => {
    await clear();
    const e = newEvent();
    expect(await inA((tx) => insertIfAbsent(tx, e))).toBe('inserted');
    const { rows } = await admin.query('SELECT * FROM inbound_events WHERE id = $1', [e.id]);
    expect(rows).toMatchObject([
      {
        org_id: A,
        workspace_id: WA,
        channel_account_id: CA,
        status: 'pending',
        attempts: 0,
        payload: { text: 'hello' },
      },
    ]);
    expect(await count('inbound_event_keys', e.platformMessageId)).toBe(1);
  });

  it('says duplicate for the same key and writes no second event', async () => {
    await clear();
    const first = newEvent();
    await inA((tx) => insertIfAbsent(tx, first));
    const again = newEvent({ platformMessageId: first.platformMessageId });
    expect(await inA((tx) => insertIfAbsent(tx, again))).toBe('duplicate');
    expect(await count('inbound_events', first.platformMessageId)).toBe(1);
    expect(
      (await admin.query('SELECT 1 FROM inbound_events WHERE id = $1', [again.id])).rowCount,
    ).toBe(0);
  });

  it('says duplicate across a month boundary, which a unique key of the partitioned table could not', async () => {
    await clear();
    const platformMessageId = 'm-month';
    const a = newEvent({ platformMessageId });
    const b = newEvent({ platformMessageId });
    expect(await inA((tx) => insertIfAbsent(tx, a))).toBe('inserted');
    // The time of receipt is the database's, so the first event is put in another month by the admin role (as the retention job
    // will find it): the row moves to another partition, and the key table does not look at partitions.
    await admin.query(
      "UPDATE inbound_events SET received_at = '2001-02-15T00:00:00Z' WHERE id = $1",
      [a.id],
    );
    expect(await inA((tx) => insertIfAbsent(tx, b))).toBe('duplicate');
    expect(await count('inbound_events', platformMessageId)).toBe(1);
    expect(await count('inbound_event_keys', platformMessageId)).toBe(1);
  });

  it('sets received_at to the now() of the database, in the partition of the current month (F-02, N123)', async () => {
    await clear();
    const e = newEvent();
    expect(await inA((tx) => insertIfAbsent(tx, e))).toBe('inserted');
    const { rows } = await admin.query<{ recent: boolean; part: string }>(
      `SELECT received_at <= now() AND received_at > now() - interval '1 minute' AS recent, tableoid::regclass::text AS part
       FROM inbound_events WHERE id = $1`,
      [e.id],
    );
    expect(rows[0]?.recent).toBe(true);
    expect(rows[0]?.part).toMatch(/^inbound_events_y\d{4}m\d{2}$/);
  });

  it('refuses a receivedAt that got past the types, before the key, and writes neither the event nor the key', async () => {
    await clear();
    const e = {
      ...newEvent(),
      receivedAt: new Date('2001-01-01T00:00:00Z'),
    } as unknown as NewInboundEvent;
    const error = await inA((tx) => insertIfAbsent(tx, e)).catch((x: unknown) => x);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('"receivedAt"');
    expect((error as Error).message).toContain('N123');
    expect((error as Error).message).not.toContain('2001');
    expect(await count('inbound_events', e.platformMessageId)).toBe(0);
    expect(await count('inbound_event_keys', e.platformMessageId)).toBe(0);
  });

  it('does not let the type carry a receivedAt: this line stops compiling if the field comes back (N123)', () => {
    const withTime: NewInboundEvent = {
      ...newEvent(),
      // @ts-expect-error receivedAt is not a field of NewInboundEvent: the database sets received_at (N123)
      receivedAt: new Date(),
    };
    expect(withTime.id).toBeTruthy();
  });

  it('takes the key back with the event when the event is refused (an account of another workspace)', async () => {
    await clear();
    const bad = newEvent({ workspaceId: WA, channelAccountId: CA2 });
    expect(await sqlState(inA((tx) => insertIfAbsent(tx, bad)))).toBe('23503');
    expect([await count('inbound_event_keys'), await count('inbound_events')]).toEqual([0, 0]);
  });

  it('refuses an account of another organisation', async () => {
    await clear();
    expect(
      await sqlState(inA((tx) => insertIfAbsent(tx, newEvent({ channelAccountId: CB })))),
    ).toBeDefined();
    expect(await count('inbound_events')).toBe(0);
  });

  it('makes a second webhook for the same key wait for the first to commit, then say duplicate', async () => {
    await clear();
    const platformMessageId = 'm-race';
    const [e1, e2] = [newEvent({ platformMessageId }), newEvent({ platformMessageId })];
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let inserted!: () => void;
    const firstInserted = new Promise<void>((resolve) => (inserted = resolve));
    const first = inA(async (tx) => {
      const r = await insertIfAbsent(tx, e1);
      inserted();
      await hold;
      return r;
    });
    await firstInserted;
    const second = inA((tx) => insertIfAbsent(tx, e2));
    // The second one must be waiting on the first (a lock nobody has granted yet), not done: proof that the key serialises the two.
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      const { rowCount } = await admin.query(
        "SELECT 1 FROM pg_locks WHERE NOT granted AND locktype = 'transactionid'",
      );
      waiting = (rowCount ?? 0) > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(waiting).toBe(true);
    release();
    expect(await Promise.all([first, second])).toEqual(['inserted', 'duplicate']);
    expect(await count('inbound_events', platformMessageId)).toBe(1);
  });
});

describe('pendingInboundWorkspaces', () => {
  it('lists the workspaces with an event due, the one waiting longest first, and nothing from another organisation', async () => {
    await clear();
    await put({ workspace: WA2, channel: CA2, received: '-1 hour' });
    await put({ received: '-1 minute' });
    await put({ due: '5 minutes' });
    await put({ status: 'claimed' });
    await put({ org: B, workspace: WB, channel: CB });
    expect(await inA((tx) => pendingInboundWorkspaces(tx))).toEqual([WA2, WA]);
    expect(await inB((tx) => pendingInboundWorkspaces(tx))).toEqual([WB]);
  });
});

describe('claimInboundBatch', () => {
  it('takes exactly the limit, the oldest first, of the one workspace asked, and counts the attempt', async () => {
    await clear();
    const ids: string[] = [];
    for (const received of ['-5 minutes', '-4 minutes', '-3 minutes', '-2 minutes'])
      ids.push(await put({ received }));
    await put({ due: '10 minutes' });
    await put({ status: 'processed' });
    await put({ workspace: WA2, channel: CA2, received: '-10 minutes' });
    const batch = await inA((tx) => claimInboundBatch(tx, { limit: 3, workspaceId: WA }));
    expect(batch.map((b) => b.id)).toEqual(ids.slice(0, 3));
    expect(batch.every((b) => b.attempts === 1 && b.workspaceId === WA && b.orgId === A)).toBe(
      true,
    );
    expect(batch[0]?.receivedAt).toBeInstanceOf(Date);
    for (const id of ids.slice(0, 3))
      expect(await row(id)).toMatchObject({ status: 'claimed', attempts: 1, claimed: true });
    // What is left of the workspace, and then the other workspace when none is named.
    expect(
      (await inA((tx) => claimInboundBatch(tx, { limit: 10, workspaceId: WA }))).map((b) => b.id),
    ).toEqual([ids[3]]);
    expect(
      (await inA((tx) => claimInboundBatch(tx, { limit: 10 }))).map((b) => b.workspaceId),
    ).toEqual([WA2]);
    expect(await inA((tx) => claimInboundBatch(tx, { limit: 10 }))).toEqual([]);
  });

  it('never takes an event of another organisation', async () => {
    await clear();
    const theirs = await put({ org: B, workspace: WB, channel: CB });
    expect(await inA((tx) => claimInboundBatch(tx, { limit: 10 }))).toEqual([]);
    expect((await row(theirs))?.status).toBe('pending');
  });

  it.each([0, 1001, 1.5, Number.NaN])(
    'refuses the limit %s before it reaches the database',
    async (limit) => {
      await expect(inA((tx) => claimInboundBatch(tx, { limit }))).rejects.toThrow(RangeError);
    },
  );

  it('gives two workers that ask at once batches that do not overlap, each of exactly its limit', async () => {
    await clear();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await put({ received: `-${10 - i} minutes` }));
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let claimed!: () => void;
    const firstClaimed = new Promise<void>((resolve) => (claimed = resolve));
    // The first worker keeps its transaction open (its rows locked) while the second asks.
    const first = inA(async (tx) => {
      const batch = await claimInboundBatch(tx, { limit: 3 });
      claimed();
      await hold;
      return batch;
    });
    await firstClaimed;
    const second = await inA((tx) => claimInboundBatch(tx, { limit: 3 }));
    release();
    const firstBatch = await first;
    expect([firstBatch.length, second.length]).toEqual([3, 3]);
    const all = [...firstBatch, ...second].map((b) => b.id);
    expect(new Set(all).size).toBe(6);
    expect([...all].sort()).toEqual([...ids].sort());
  });
});

describe('markInboundProcessed and markInboundIgnored', () => {
  // The rows come from put(), with received_at = now(): microseconds in the database, milliseconds in a Date. The key made from a
  // claimed row must still find its row.
  const claimOne = async () => {
    await clear();
    const id = await put();
    const [claimed] = await inA((tx) => claimInboundBatch(tx, { limit: 1 }));
    return { id, key: { id: claimed?.id as string, receivedAt: claimed?.receivedAt as Date } };
  };

  it('marks a claimed event processed, once', async () => {
    const { id, key } = await claimOne();
    expect(await inA((tx) => markInboundProcessed(tx, key))).toBe(true);
    expect(await row(id)).toMatchObject({ status: 'processed', done: true });
    expect(await inA((tx) => markInboundProcessed(tx, key))).toBe(false);
  });

  it('says false when the worker no longer holds the event (the lease was taken back), and leaves the row alone', async () => {
    const { id, key } = await claimOne();
    await admin.query(
      "UPDATE inbound_events SET status = 'pending', claimed_at = NULL WHERE id = $1",
      [id],
    );
    expect(await inA((tx) => markInboundProcessed(tx, key))).toBe(false);
    expect(await inA((tx) => markInboundIgnored(tx, key, 'E_NOT_A_MESSAGE'))).toBe(false);
    expect(await row(id)).toMatchObject({ status: 'pending', done: false });
  });

  it('does not mark an event that is only pending', async () => {
    await clear();
    const id = await put();
    const { rows } = await admin.query<{ received_at: Date }>(
      'SELECT received_at FROM inbound_events WHERE id = $1',
      [id],
    );
    const key = { id, receivedAt: rows[0]?.received_at as Date };
    expect(await inA((tx) => markInboundProcessed(tx, key))).toBe(false);
    expect((await row(id))?.status).toBe('pending');
  });

  it('marks an event ignored with the code of the reason', async () => {
    const { id, key } = await claimOne();
    expect(await inA((tx) => markInboundIgnored(tx, key, 'E_NOT_A_MESSAGE'))).toBe(true);
    expect(await row(id)).toMatchObject({
      status: 'ignored',
      last_error: 'E_NOT_A_MESSAGE',
      done: true,
    });
  });

  it.each(['e_lower', 'Nguyen Van A', '090 123 4567', '', `E_${'X'.repeat(70)}`])(
    'refuses %j as a reason, does not repeat it in the error, and leaves the row claimed',
    async (reason) => {
      const { id, key } = await claimOne();
      const error = await inA((tx) => markInboundIgnored(tx, key, reason)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TypeError);
      if (reason.trim()) expect((error as Error).message).not.toContain(reason.trim());
      expect((await row(id))?.status).toBe('claimed');
    },
  );
});
