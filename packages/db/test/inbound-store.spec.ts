import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  insertIfAbsent,
  pendingInboundWorkspaces,
  withTenant,
  type NewInboundEvent,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The first part of the inbound store (N106): record an event once, and list the workspaces with work.
// Org A has workspaces WA and WA2 (an account in each); B is a stranger. The test that needs two transactions at once (the key) uses
// two pooled connections and is the one PGlite cannot run. Times are offsets from now(), so nothing sleeps.
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
    const a = newEvent({ platformMessageId, receivedAt: new Date('2001-02-15T00:00:00Z') });
    const b = newEvent({ platformMessageId, receivedAt: new Date('2001-03-15T00:00:00Z') });
    expect(await inA((tx) => insertIfAbsent(tx, a))).toBe('inserted');
    expect(await inA((tx) => insertIfAbsent(tx, b))).toBe('duplicate');
    expect(await count('inbound_events', platformMessageId)).toBe(1);
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
