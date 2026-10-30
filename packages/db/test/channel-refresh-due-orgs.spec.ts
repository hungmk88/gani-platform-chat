import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// app.channel_refresh_due_orgs (zalo-channel spec §4, B2-1a, N173): which organisations have a channel account whose tokens the
// refresh job must renew, asked outside any tenant. Each organisation has the one Zalo OA account of seedTenant; `set` puts it in the
// state a case needs, times as offsets from now() so nothing sleeps. D is a deleted organisation. The result is cut down to the
// organisations of this spec, so rows another spec left cannot change it.
const [A, B, D] = [uuidv7(), uuidv7(), uuidv7()];
const orgs = [A, B, D];
const users = new Map<string, string>();
const account = new Map<string, string>();
let admin: pg.Client;
let app: pg.Client;
let support: pg.Client;

interface State {
  status?: string;
  expires?: string | null;
  claimed?: string | null;
  refresh?: boolean;
  deleted?: boolean;
}
const set = (org: string, s: State = {}) =>
  admin.query(
    `UPDATE channel_accounts SET status = $2, access_token_expires_at = now() + $3::interval,
       refresh_claimed_at = now() + $4::interval, refresh_token_enc = CASE WHEN $5 THEN $6::bytea END,
       deleted_at = CASE WHEN $7 THEN now() END
     WHERE org_id = $1`,
    [
      org,
      s.status ?? 'connected',
      s.expires === undefined ? '30 minutes' : s.expires,
      s.claimed ?? null,
      s.refresh ?? true,
      randomBytes(32),
      s.deleted ?? false,
    ],
  );
const due = async (lease = 60) => {
  const { rows } = await app.query<{ org_id: string }>(
    'SELECT org_id FROM app.channel_refresh_due_orgs(10, 3600, $1)',
    [lease],
  );
  return rows.map((r) => r.org_id).filter((o) => orgs.includes(o));
};

beforeAll(async () => {
  [admin, app, support] = [
    new pg.Client({ connectionString: url('migration') }),
    new pg.Client({ connectionString: url('app') }),
    new pg.Client({ connectionString: url('support') }),
  ];
  await Promise.all([admin.connect(), app.connect(), support.connect()]);
  for (const org of orgs) {
    users.set(org, await seedTenant(admin, org));
    const { rows } = await admin.query<{ id: string }>(
      'SELECT id FROM channel_accounts WHERE org_id = $1',
      [org],
    );
    account.set(org, rows[0]!.id);
  }
  await admin.query('UPDATE organizations SET deleted_at = now() WHERE id = $1', [D]);
});

afterAll(async () => {
  await Promise.all([app.end(), support.end()]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('the function', () => {
  it('is SECURITY DEFINER and STABLE, pins its search_path, returns ids only; only app_role may run it', async () => {
    const fn = await admin.query(
      `SELECT prosecdef AS definer, provolatile AS vol, pg_get_function_result(oid) AS result, proconfig AS cfg
       FROM pg_proc WHERE proname = 'channel_refresh_due_orgs'`,
    );
    expect(fn.rows).toEqual([
      {
        definer: true,
        vol: 's',
        result: 'TABLE(org_id uuid)',
        cfg: ['search_path=pg_catalog, public, pg_temp'],
      },
    ]);
    const { rows } = await admin.query<{ r: string; ok: boolean }>(
      `SELECT r, has_function_privilege(r, 'app.channel_refresh_due_orgs(integer, integer, integer)', 'EXECUTE') AS ok
       FROM unnest(ARRAY['app_role', 'auth_role', 'support_role', 'public']) AS r`,
    );
    expect(rows.filter((x) => x.ok).map((x) => x.r)).toEqual(['app_role']);
    const call = 'SELECT * FROM app.channel_refresh_due_orgs(10, 60, 60)';
    expect(await sqlState(support.query(call))).toBe('42501');
  });

  it.each([
    [0, 60, 60],
    [1001, 60, 60],
    [10, -1, 60],
    [10, 60, 0],
    [null, 60, 60],
    [10, null, 60],
    [10, 60, null],
  ])('refuses limit %s, before %s, lease %s (22023)', async (limit, before, lease) => {
    const call = 'SELECT * FROM app.channel_refresh_due_orgs($1, $2, $3)';
    expect(await sqlState(app.query(call, [limit, before, lease]))).toBe('22023');
  });
});

describe('what is due', () => {
  it('names a live account that expires within the window; not one that is far, gone, unusable or held', async () => {
    await set(A);
    await set(B, { expires: '2 hours' });
    await set(D);
    expect(await due()).toEqual([A]);
    const not: State[] = [
      { status: 'disconnected' },
      { deleted: true },
      { refresh: false },
      { expires: null },
      { claimed: '-5 seconds' },
    ];
    for (const s of not) {
      await set(A, s);
      expect(await due(), JSON.stringify(s)).toEqual([]);
    }
    await set(A, { status: 'token_expiring', claimed: '-5 minutes' });
    expect(await due()).toEqual([A]);
    expect(await due(3600)).toEqual([]);
  });

  it('names both organisations, ids only, while a session of A still reads only the account of A', async () => {
    await set(A);
    await set(B);
    expect((await due()).sort()).toEqual([A, B].sort());
    const read = () => app.query<{ id: string }>('SELECT id FROM channel_accounts');
    const seen = (await asApp(app, A, [], read)).rows.map((r) => r.id);
    expect(seen).toContain(account.get(A));
    expect(seen).not.toContain(account.get(B));
  });
});
