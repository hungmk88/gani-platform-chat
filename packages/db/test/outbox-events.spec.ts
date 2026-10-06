import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, insertOutboxEvent, withTenant, type NewOutboxEvent } from '../src/index.js';
import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// outbox_events (M1.2 outbox O-1): O by organisation, partitioned by month, a row nobody edits except the columns that follow the relay.
// Org A has workspace WA; org B is a stranger (it owns the workspace WB, which A may not use).
const [A, B] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
let [WA, WB] = ['', ''];
let admin: pg.Client;
let app: pg.Client;
let pool: pg.Pool;

// prettier-ignore
const event = (over: Partial<NewOutboxEvent> = {}): NewOutboxEvent => ({
  id: uuidv7(), workspaceId: WA, eventType: 'conversation.state_changed', aggregateType: 'conversation', aggregateId: uuidv7(),
  aggregateVersion: 1, payload: { from: 'BOT_ACTIVE', to: 'HUMAN_WAITING_Q' }, actorKind: 'bot', actorId: null, traceId: 'trace', ...over,
});
const raw = `INSERT INTO outbox_events (id, org_id, event_type, aggregate_type, aggregate_id, actor_kind, trace_id) VALUES ($1, $2, 'e.x', 'conversation', $3, 'system', 't')`;
const put = async (org = A) => {
  const id = uuidv7();
  await admin.query(raw, [id, org, uuidv7()]);
  return id;
};
const column = async (id: string, name: string) =>
  (
    await admin.query<Record<string, unknown>>(
      `SELECT ${name} AS v FROM outbox_events WHERE id = $1`,
      [id],
    )
  ).rows[0]?.['v'];
const asA = <T>(ws: string[], fn: () => Promise<T>) => asApp(app, A, ws, fn);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  const ws = async (org: string) =>
    (await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [org]))
      .rows[0]?.id as string;
  [WA, WB] = [await ws(A), await ws(B)];
});

afterAll(async () => {
  await Promise.all([app.end(), pool.end()]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('insertOutboxEvent', () => {
  it('adds a pending event in the organisation of the context, with the defaults of the table', async () => {
    const e = event();
    await withTenant(pool, { orgId: A, workspaceIds: [WA] }, (tx) => insertOutboxEvent(tx, e));
    const { rows } = await admin.query('SELECT * FROM outbox_events WHERE id = $1', [e.id]);
    expect(rows).toMatchObject([
      {
        org_id: A,
        workspace_id: WA,
        status: 'pending',
        attempts: 0,
        event_version: 1,
        aggregate_version: 1,
        payload: e.payload,
        claimed_at: null,
        published_at: null,
        last_error: null,
      },
    ]);
  });

  it('takes an event of the whole organisation (no workspace), and is seen with no workspace in the context', async () => {
    const e = event({ workspaceId: null });
    await withTenant(pool, { orgId: A, workspaceIds: [] }, (tx) => insertOutboxEvent(tx, e));
    expect(await column(e.id, 'workspace_id')).toBeNull();
    expect(
      await asA(
        [],
        async () => (await app.query('SELECT 1 FROM outbox_events WHERE id = $1', [e.id])).rowCount,
      ),
    ).toBe(1);
  });

  it('refuses a workspace of another organisation (23503)', async () => {
    const run = withTenant(pool, { orgId: A, workspaceIds: [] }, (tx) =>
      insertOutboxEvent(tx, event({ workspaceId: WB })),
    );
    expect(await sqlState(run)).toBe('23503');
  });
});

describe('isolation by organisation', () => {
  it('shows an organisation its own events only, and refuses to write for another (42501)', async () => {
    const [mine, theirs] = [await put(A), await put(B)];
    const seen = await asA([WA], async () =>
      (await app.query<{ id: string }>('SELECT id FROM outbox_events')).rows.map((r) => r.id),
    );
    expect(seen).toContain(mine);
    expect(seen).not.toContain(theirs);
    expect(await sqlState(asA([WA], () => app.query(raw, [uuidv7(), B, uuidv7()])))).toBe('42501');
    expect(
      await sqlState(
        asA([WA], () => app.query('UPDATE outbox_events SET attempts = 9 WHERE id = $1', [theirs])),
      ),
    ).toBe(undefined);
    expect(await column(theirs, 'attempts')).toBe(0);
  });
});

describe('what app_role may change', () => {
  it('lets the columns that follow the relay change, and nothing else', async () => {
    const id = await put();
    const set = (sql: string) =>
      asA([WA], () => app.query(`UPDATE outbox_events SET ${sql} WHERE id = $1`, [id]));
    expect(
      (
        await set(
          "status = 'claimed', claimed_at = now(), attempts = attempts + 1, available_at = now(), last_error = 'E_TIMEOUT'",
        )
      ).rowCount,
    ).toBe(1);
    expect((await set("status = 'published', published_at = now()")).rowCount).toBe(1);
    for (const sql of [
      "payload = '{}'",
      "event_type = 'x.y'",
      'aggregate_id = gen_random_uuid()',
      "actor_kind = 'bot'",
      "trace_id = 'x'",
      'org_id = org_id',
    ]) {
      expect(await sqlState(set(sql)), sql).toBe('42501');
    }
    expect(
      await sqlState(asA([WA], () => app.query('DELETE FROM outbox_events WHERE id = $1', [id]))),
    ).toBe('42501');
  });
});

describe('the columns of outbox_events', () => {
  const edit = (sql: string) => async () => {
    const id = await put();
    return sqlState(admin.query(`UPDATE outbox_events SET ${sql} WHERE id = $1`, [id]));
  };

  it.each([
    ['an unknown status', "status = 'lost'"],
    ['a negative attempts', 'attempts = -1'],
    ['published without published_at', "status = 'published'"],
    ['published_at on a row that is not published', 'published_at = now()'],
    ['claimed without claimed_at', "status = 'claimed'"],
    [
      'a last_error that is a message, not a code (65 characters)',
      `last_error = '${'x'.repeat(65)}'`,
    ],
    ['a blank last_error', "last_error = ' '"],
    ['a payload that is not an object', "payload = '[]'"],
    ['a blank trace_id', "trace_id = ' '"],
    ['an unknown actor_kind', "actor_kind = 'robot'"],
  ])('refuses %s (23514)', async (_name, sql) => {
    expect(await edit(sql)()).toBe('23514');
  });
});

describe('partitions and indexes', () => {
  it('routes a row to the monthly partition of its date, an old date to DEFAULT', async () => {
    const [recent, old] = [await put(), uuidv7()];
    await admin.query(
      `INSERT INTO outbox_events (id, org_id, event_type, aggregate_type, aggregate_id, actor_kind, trace_id, created_at) VALUES ($1, $2, 'e.x', 'conversation', $3, 'system', 't', '2001-01-01T00:00:00Z')`,
      [old, A, uuidv7()],
    );
    const { rows } = await admin.query<{ id: string; t: string }>(
      'SELECT id, tableoid::regclass::text AS t FROM outbox_events WHERE id = ANY($1::uuid[])',
      [[recent, old]],
    );
    const at = (id: string) => rows.find((r) => r.id === id)?.t;
    expect(at(recent)).toMatch(/^outbox_events_y\d{4}m\d{2}$/);
    expect(at(old)).toBe('outbox_events_default');
  });

  it('has the index of Brief P8 and the two partial ones the relay reads', async () => {
    const { rows } = await admin.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'outbox_events' ORDER BY indexname",
    );
    const def = (name: string) => rows.find((r) => r.indexname === name)?.indexdef ?? '';
    expect(def('outbox_events_status_created_idx')).toContain('(status, created_at)');
    expect(def('outbox_events_due_idx')).toMatch(
      /\(org_id, available_at\) WHERE \(status = 'pending'/,
    );
    expect(def('outbox_events_claimed_idx')).toMatch(
      /\(org_id, claimed_at\) WHERE \(status = 'claimed'/,
    );
  });
});
