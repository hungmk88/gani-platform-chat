import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';

// channel_policies (channel-policy-spec §1): a global table. The seed rows of 202610071110, the constraints, and the access of
// app_role and support_role (read only, no tenant, no access-session). The grants of the table are also checked by rls-all-tables.spec.
const SOURCE =
  'https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099';
const SEED_FROM = '2023-06-20T00:00:00+07:00';
// Rows the tests add use a start date far in the future, so they never meet a real policy; afterAll removes them.
const TEST_YEAR = 2999;
let admin: pg.Client;
let app: pg.Client;
let support: pg.Client;
let nextDay = 1;

interface PolicyOver {
  channel?: string;
  klass?: string;
  from?: string;
  window?: number | null;
  quota?: number | null;
  price?: number | null;
  outside?: boolean | null;
  sourceUrl?: string | null;
  note?: string | null;
}
function addPolicy(over: PolicyOver = {}, client?: pg.Client) {
  const v = {
    channel: 'zalo_oa',
    klass: 'advisory',
    from: new Date(Date.UTC(TEST_YEAR, 0, nextDay++)).toISOString(),
    window: null,
    quota: null,
    price: null,
    outside: true,
    sourceUrl: null,
    note: 'test',
    ...over,
  };
  return (client ?? admin).query(
    `INSERT INTO channel_policies (id, channel_type, message_class, effective_from, free_window_seconds, free_message_quota, unit_price_vnd, outside_window_allowed, source_url, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      uuidv7(),
      v.channel,
      v.klass,
      v.from,
      v.window,
      v.quota,
      v.price,
      v.outside,
      v.sourceUrl,
      v.note,
    ],
  );
}

beforeAll(async () => {
  [admin, app, support] = [
    new pg.Client({ connectionString: url('migration') }),
    new pg.Client({ connectionString: url('app') }),
    new pg.Client({ connectionString: url('support') }),
  ];
  await Promise.all([admin.connect(), app.connect(), support.connect()]);
});

afterAll(async () => {
  await Promise.all([app.end(), support.end()]);
  await admin.query("DELETE FROM channel_policies WHERE effective_from >= '2999-01-01T00:00:00Z'");
  await admin.end();
});

describe('the rows seeded by the migration', () => {
  const seeded = async (klass: string) =>
    (
      await app.query<Record<string, unknown>>(
        'SELECT *, source_date::text AS source_day FROM channel_policies WHERE channel_type = $1 AND message_class = $2 AND effective_from = $3',
        ['zalo_oa', klass, SEED_FROM],
      )
    ).rows;

  it('has the advisory policy of the Zalo OA announcement, marked as temporary', async () => {
    const rows = await seeded('advisory');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      free_window_seconds: 172800,
      free_message_quota: 8,
      unit_price_vnd: 55,
      outside_window_allowed: true,
      source_url: SOURCE,
      source_day: '2024-01-15',
      note: 'tạm, chờ xác nhận',
    });
  });

  it('has the transaction policy, without a window or a quota, marked as temporary', async () => {
    const rows = await seeded('transaction');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      free_window_seconds: null,
      free_message_quota: null,
      unit_price_vnd: 165,
      outside_window_allowed: true,
      source_url: SOURCE,
      note: 'tạm, chờ xác nhận',
    });
  });

  it('has no policy for broadcast', async () => {
    expect(await seeded('broadcast')).toHaveLength(0);
  });
});

describe('access', () => {
  it('lets app_role read without a tenant context', async () => {
    const { rows } = await app.query('SELECT 1 FROM channel_policies');
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('lets support_role read without an access-session', async () => {
    const { rows } = await support.query('SELECT 1 FROM channel_policies');
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['app_role', () => app],
    ['support_role', () => support],
  ])('refuses %s to insert, update or delete (42501)', async (_role, client) => {
    expect(await sqlState(addPolicy({}, client()))).toBe('42501');
    expect(await sqlState(client().query('UPDATE channel_policies SET note = $1', ['x']))).toBe(
      '42501',
    );
    expect(await sqlState(client().query('DELETE FROM channel_policies'))).toBe('42501');
  });
});

describe('constraints', () => {
  it('keeps one policy per channel, class and start date (23505)', async () => {
    const from = `${TEST_YEAR}-06-01T00:00:00Z`;
    await addPolicy({ from });
    expect(await sqlState(addPolicy({ from }))).toBe('23505');
    await addPolicy({ from, klass: 'transaction' });
    await addPolicy({ from, channel: 'facebook' });
  });

  it.each<[string, PolicyOver]>([
    ['an unknown channel', { channel: 'telegram' }],
    ['an unknown class', { klass: 'promo' }],
    ['a negative window', { window: -1 }],
    ['a negative quota', { quota: -1 }],
    ['a negative price', { price: -1 }],
    ['a blank source_url', { sourceUrl: ' ' }],
    ['a blank note', { note: ' ' }],
  ])('rejects %s (23514)', async (_name, over) => {
    expect(await sqlState(addPolicy(over))).toBe('23514');
  });

  it.each<[string, PolicyOver]>([
    ['no answer on outside_window_allowed', { outside: null }],
    ['no note', { note: null }],
  ])('rejects %s (23502)', async (_name, over) => {
    expect(await sqlState(addPolicy(over))).toBe('23502');
  });

  it('rejects no start date (23502)', async () => {
    expect(
      await sqlState(
        admin.query(
          "INSERT INTO channel_policies (id, channel_type, message_class, effective_from, outside_window_allowed, note) VALUES ($1, 'zalo_oa', 'advisory', NULL, true, 'x')",
          [uuidv7()],
        ),
      ),
    ).toBe('23502');
  });

  it('accepts zero values, every class and every channel', async () => {
    await addPolicy({ window: 0, quota: 0, price: 0, outside: false });
    for (const klass of ['advisory', 'transaction', 'broadcast']) await addPolicy({ klass });
    for (const channel of ['zalo_oa', 'facebook', 'webchat']) await addPolicy({ channel });
  });
});

describe('columns', () => {
  it('keeps exactly the expected columns: a new one has to be looked at here', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'channel_policies' ORDER BY ordinal_position",
    );
    expect(rows.map((r) => r.column_name)).toEqual(
      'id channel_type message_class effective_from free_window_seconds free_message_quota unit_price_vnd outside_window_allowed source_url source_date note created_at'.split(
        ' ',
      ),
    );
  });
});
