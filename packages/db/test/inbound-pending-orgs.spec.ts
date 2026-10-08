import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// app.inbound_pending_orgs (inbound-spec §2): which organisations have inbound work for the worker, asked outside any tenant.
// A and B have events of their own; D is deleted. Times are offsets from now() so the tests do not sleep. The result is cut down to
// the organisations of this spec, so rows left by another spec cannot change it; the sample rows of seedTenant are removed first.
const [A, B, D] = [uuidv7(), uuidv7(), uuidv7()];
const orgs = [A, B, D];
const users = new Map<string, string>();
const where = new Map<string, { workspace: string; channel: string }>();
let admin: pg.Client;
let app: pg.Client;
let support: pg.Client;
let auth: pg.Client;

interface Row {
  status?: string;
  /** available_at, as an offset from now(). */
  due?: string;
  /** claimed_at, as an offset from now(). */
  claimed?: string;
  /** received_at, as an offset from now(). */
  received?: string;
}
// prettier-ignore
const put = async (org: string, o: Row = {}) => {
  const place = where.get(org) as { workspace: string; channel: string };
  const id = uuidv7();
  await admin.query(
    `INSERT INTO inbound_events (id, org_id, workspace_id, channel_account_id, platform_message_id, event_type, payload, received_at, status, available_at, claimed_at, processed_at, last_error)
     VALUES ($1, $2, $3, $4, $5, 't', '{}', now() + $6::interval, $7, now() + $8::interval,
       CASE WHEN $7 = 'claimed' THEN now() + $9::interval END,
       CASE WHEN $7 IN ('processed', 'ignored') THEN now() END,
       CASE WHEN $7 IN ('ignored', 'dead_letter') THEN 'E_X' END)`,
    [id, org, place.workspace, place.channel, `m-${id}`, o.received ?? '0', o.status ?? 'pending', o.due ?? '-1 minute', o.claimed ?? '0'],
  );
};
const clear = () =>
  admin.query('DELETE FROM inbound_events WHERE org_id = ANY($1::uuid[])', [orgs]);
const pending = async (limit: number, lease?: number) => {
  const { rows } =
    lease === undefined
      ? await app.query<{ org_id: string }>('SELECT org_id FROM app.inbound_pending_orgs($1)', [
          limit,
        ])
      : await app.query<{ org_id: string }>('SELECT org_id FROM app.inbound_pending_orgs($1, $2)', [
          limit,
          lease,
        ]);
  return rows.map((r) => r.org_id).filter((o) => orgs.includes(o));
};

beforeAll(async () => {
  [admin, app, support, auth] = [
    new pg.Client({ connectionString: url('migration') }),
    new pg.Client({ connectionString: url('app') }),
    new pg.Client({ connectionString: url('support') }),
    new pg.Client({ connectionString: url('auth') }),
  ];
  await Promise.all([admin.connect(), app.connect(), support.connect(), auth.connect()]);
  for (const org of orgs) {
    users.set(org, await seedTenant(admin, org));
    const { rows } = await admin.query<{ workspace: string; channel: string }>(
      'SELECT workspace_id AS workspace, id AS channel FROM channel_accounts WHERE org_id = $1',
      [org],
    );
    where.set(org, rows[0] as { workspace: string; channel: string });
  }
  await admin.query('UPDATE organizations SET deleted_at = now() WHERE id = $1', [D]);
});

afterAll(async () => {
  await Promise.all([app.end(), support.end(), auth.end()]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('the function', () => {
  it('is a SECURITY DEFINER function (not a view) with a fixed search_path, and returns only organisation ids', async () => {
    const fn = await admin.query<{ definer: boolean; vol: string; result: string; cfg: string[] }>(
      `SELECT prosecdef AS definer, provolatile AS vol, pg_get_function_result(oid) AS result, proconfig AS cfg
       FROM pg_proc WHERE proname = 'inbound_pending_orgs'`,
    );
    expect(fn.rows).toEqual([
      {
        definer: true,
        vol: 's',
        result: 'TABLE(org_id uuid)',
        cfg: ['search_path=pg_catalog, public, pg_temp'],
      },
    ]);
    expect(
      (await admin.query("SELECT 1 FROM pg_views WHERE viewname = 'inbound_pending_orgs'"))
        .rowCount,
    ).toBe(0);
  });

  it('is executable by app_role only (not support_role, not auth_role, not PUBLIC)', async () => {
    const { rows } = await admin.query<{ r: string; ok: boolean }>(
      `SELECT r, has_function_privilege(r, 'app.inbound_pending_orgs(integer, integer)', 'EXECUTE') AS ok
       FROM unnest(ARRAY['app_role', 'auth_role', 'support_role', 'public']) AS r`,
    );
    expect(rows.filter((x) => x.ok).map((x) => x.r)).toEqual(['app_role']);
    const call = 'SELECT * FROM app.inbound_pending_orgs(10, 60)';
    expect(await sqlState(support.query(call))).toBe('42501');
    expect(await sqlState(auth.query(call))).toBe('42501');
  });

  it.each([
    [0, 60],
    [1001, 60],
    [10, 0],
    [null, 60],
    [10, null],
  ])('refuses limit %s with lease %s (22023)', async (limit, lease) => {
    expect(
      await sqlState(app.query('SELECT * FROM app.inbound_pending_orgs($1, $2)', [limit, lease])),
    ).toBe('22023');
  });
});

describe('what counts as work', () => {
  it('names an organisation with a due pending event, and not one still waiting for its backoff', async () => {
    await clear();
    await put(A, { received: '-1 hour' });
    await put(B, { due: '5 minutes' });
    expect(await pending(10, 60)).toEqual([A]);
  });

  it('counts a claimed event only once its lease is over', async () => {
    await clear();
    await put(B, { status: 'claimed', claimed: '-5 seconds' });
    expect(await pending(10, 60)).toEqual([]);
    await put(B, { status: 'claimed', claimed: '-5 minutes' });
    expect(await pending(10, 60)).toEqual([B]);
    expect(await pending(10, 3600)).toEqual([]);
  });

  it('does not count finished or dead events, nor an organisation that is deleted', async () => {
    await clear();
    for (const status of ['processed', 'ignored', 'dead_letter']) await put(A, { status });
    await put(D);
    expect(await pending(10, 60)).toEqual([]);
  });

  it('works without a tenant context, and the lease defaults to 60 seconds', async () => {
    await clear();
    await put(A);
    await put(B, { status: 'claimed', claimed: '-5 minutes' });
    await put(A, { status: 'claimed', claimed: '-5 seconds' });
    expect(await pending(10)).toEqual(await pending(10, 60));
    expect(await pending(10)).toEqual([A, B]);
  });
});

describe('order and limit', () => {
  it('names the organisation with the oldest work first, and cuts the list at p_limit', async () => {
    await clear();
    // Older than anything another spec could have left, so the cut cannot be taken by a stranger.
    await put(B, { received: '-3 years' });
    await put(A, { received: '-2 years' });
    expect(await pending(10, 60)).toEqual([B, A]);
    expect(await pending(1, 60)).toEqual([B]);
  });
});
