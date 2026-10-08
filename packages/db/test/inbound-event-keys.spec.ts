import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// inbound_event_keys (I1): the primary key that stops a webhook sent again, isolation by organisation, and the function that removes
// old keys (app_role has no DELETE on a table with RLS, so it goes through app.purge_inbound_event_keys).
const [A, B] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
let [CA, CB] = ['', ''];
let admin: pg.Client;
let app: pg.Client;
let support: pg.Client;
let auth: pg.Client;

const KEY =
  'INSERT INTO inbound_event_keys (org_id, channel_account_id, platform_message_id) VALUES ($1, $2, $3)';
const OLD = (
  days: number,
) => `INSERT INTO inbound_event_keys (org_id, channel_account_id, platform_message_id, created_at)
  VALUES ($1, $2, $3, now() - make_interval(days => ${days}))`;
const asA = <T>(fn: () => Promise<T>) => asApp(app, A, [], fn);
const count = async (messageId: string) =>
  (
    await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM inbound_event_keys WHERE platform_message_id = $1',
      [messageId],
    )
  ).rows[0]?.n;
const purge = (days: number, limit: number, client = app) =>
  client.query<{ n: number }>('SELECT app.purge_inbound_event_keys($1, $2) AS n', [days, limit]);

beforeAll(async () => {
  [admin, app, support, auth] = [
    new pg.Client({ connectionString: url('migration') }),
    new pg.Client({ connectionString: url('app') }),
    new pg.Client({ connectionString: url('support') }),
    new pg.Client({ connectionString: url('auth') }),
  ];
  await Promise.all([admin.connect(), app.connect(), support.connect(), auth.connect()]);
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  const channel = async (org: string) =>
    (
      (
        await admin.query<{ id: string }>('SELECT id FROM channel_accounts WHERE org_id = $1', [
          org,
        ])
      ).rows[0] as { id: string }
    ).id;
  [CA, CB] = [await channel(A), await channel(B)];
});

afterAll(async () => {
  await Promise.all([app.end(), support.end(), auth.end()]);
  await admin.query('DELETE FROM inbound_event_keys WHERE org_id = ANY($1::uuid[])', [[A, B]]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('the key', () => {
  it('stops a second event with the same id for the same channel: ON CONFLICT DO NOTHING inserts 0 rows', async () => {
    const [first, again] = await asA(async () => [
      await app.query(`${KEY} ON CONFLICT DO NOTHING`, [A, CA, 'dup-1']),
      await app.query(`${KEY} ON CONFLICT DO NOTHING`, [A, CA, 'dup-1']),
    ]);
    expect([first?.rowCount, again?.rowCount]).toEqual([1, 0]);
    await admin.query(KEY, [A, CA, 'dup-2']);
    expect(await sqlState(admin.query(KEY, [A, CA, 'dup-2']))).toBe('23505');
    expect(await count('dup-2')).toBe(1);
  });

  it('is not affected by the date: the same id is a duplicate in any month', async () => {
    await admin.query(OLD(40), [A, CA, 'dup-month']);
    expect(await sqlState(admin.query(KEY, [A, CA, 'dup-month']))).toBe('23505');
  });

  it('lets two channels use the same message id', async () => {
    await admin.query(KEY, [A, CA, 'shared']);
    await admin.query(KEY, [B, CB, 'shared']);
    expect(await count('shared')).toBe(2);
  });

  it('refuses a blank id (23514) and a channel account of another organisation (23503)', async () => {
    expect(await sqlState(admin.query(KEY, [A, CA, ' ']))).toBe('23514');
    expect(await sqlState(admin.query(KEY, [A, CB, 'x']))).toBe('23503');
  });
});

describe('isolation and privileges', () => {
  it('shows a tenant its own keys only, and refuses to write for another org (42501)', async () => {
    await admin.query(KEY, [B, CB, 'theirs']);
    const seen = await asA(async () =>
      (
        await app.query<{ platform_message_id: string }>(
          'SELECT platform_message_id FROM inbound_event_keys',
        )
      ).rows.map((r) => r.platform_message_id),
    );
    expect(seen).not.toContain('theirs');
    expect(await sqlState(asA(() => app.query(KEY, [B, CB, 'x'])))).toBe('42501');
  });

  it('cannot be changed or deleted by app_role, and support_role only reads', async () => {
    expect(
      await sqlState(
        asA(() => app.query("UPDATE inbound_event_keys SET platform_message_id = 'z'")),
      ),
    ).toBe('42501');
    expect(await sqlState(asA(() => app.query('DELETE FROM inbound_event_keys')))).toBe('42501');
    expect(await sqlState(support.query(KEY, [A, CA, 'x']))).toBe('42501');
  });
});

describe('app.purge_inbound_event_keys', () => {
  it('removes the keys older than the retention and keeps the newer ones, for every organisation', async () => {
    await admin.query(OLD(36), [A, CA, 'old-a']);
    await admin.query(OLD(36), [B, CB, 'old-b']);
    await admin.query(OLD(34), [A, CA, 'recent']);
    await admin.query(KEY, [A, CA, 'fresh']);
    expect((await purge(35, 1000)).rows[0]?.n).toBeGreaterThanOrEqual(2);
    expect([await count('old-a'), await count('old-b')]).toEqual([0, 0]);
    expect([await count('recent'), await count('fresh')]).toEqual([1, 1]);
  });

  it('removes at most p_limit keys per call', async () => {
    for (const id of ['lim-1', 'lim-2', 'lim-3']) await admin.query(OLD(60), [A, CA, id]);
    expect((await purge(35, 2)).rows[0]?.n).toBe(2);
    expect((await purge(35, 1000)).rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it('refuses a retention under 30 days and a limit out of range (22023)', async () => {
    for (const [days, limit] of [
      [29, 10],
      [0, 10],
      [35, 0],
      [35, 10001],
    ] as const) {
      expect(await sqlState(purge(days, limit)), `${days}/${limit}`).toBe('22023');
    }
    await admin.query(OLD(31), [A, CA, 'at-thirty']);
    await purge(30, 1000);
    expect(await count('at-thirty')).toBe(0);
  });

  it('can be run by app_role only', async () => {
    expect(await sqlState(purge(35, 10, support))).toBe('42501');
    expect(await sqlState(purge(35, 10, auth))).toBe('42501');
    const { rows } = await admin.query(
      `SELECT 1 FROM pg_proc WHERE proname = 'purge_inbound_event_keys' AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']`,
    );
    expect(rows).toHaveLength(1);
  });
});
