import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// app.outbound_pending_orgs (O1, N185): which organisations have deliveries for the outbound worker, asked outside any tenant. A and B
// have deliveries of their own; D is deleted. Times are offsets from now() so the tests do not sleep. The result is cut down to the
// organisations of this spec, so rows left by another spec cannot change it; the sample rows of seedTenant are removed first.
const [A, B, D] = [uuidv7(), uuidv7(), uuidv7()];
const orgs = [A, B, D];
const users = new Map<string, string>();
const where = new Map<string, { workspace: string; channel: string; conversation: string }>();
let admin: pg.Client;
let app: pg.Client;
let support: pg.Client;
let auth: pg.Client;

interface Row {
  status?: 'pending' | 'sent' | 'failed';
  /** next_attempt_at, as an offset from now(). */
  due?: string;
  /** claimed_at, as an offset from now(); absent: not claimed. */
  claimed?: string;
}
// prettier-ignore
const put = async (org: string, o: Row = {}) => {
  const place = where.get(org)!;
  const status = o.status ?? 'pending';
  await admin.query(
    `INSERT INTO message_deliveries (id, org_id, workspace_id, conversation_id, message_id, channel_account_id, status, next_attempt_at,
       claimed_at, sent_at, platform_message_id, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + $8::interval, now() + $9::interval,
       CASE WHEN $7 = 'sent' THEN now() END, CASE WHEN $7 = 'sent' THEN 'p-1' END, CASE WHEN $7 = 'failed' THEN 'E_X' END)`,
    [uuidv7(), org, place.workspace, place.conversation, uuidv7(), place.channel, status, o.due ?? '-1 minute', o.claimed ?? null],
  );
};
const clear = () =>
  admin.query('DELETE FROM message_deliveries WHERE org_id = ANY($1::uuid[])', [orgs]);
const pending = async (limit: number, lease?: number) => {
  const { rows } =
    lease === undefined
      ? await app.query<{ org_id: string }>('SELECT org_id FROM app.outbound_pending_orgs($1)', [
          limit,
        ])
      : await app.query<{ org_id: string }>(
          'SELECT org_id FROM app.outbound_pending_orgs($1, $2)',
          [limit, lease],
        );
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
    const { rows } = await admin.query<{
      workspace: string;
      channel: string;
      conversation: string;
    }>(
      `SELECT c.workspace_id AS workspace, c.id AS channel, v.id AS conversation
       FROM channel_accounts c JOIN conversations v ON v.org_id = c.org_id AND v.workspace_id = c.workspace_id
       WHERE c.org_id = $1 LIMIT 1`,
      [org],
    );
    where.set(org, rows[0]!);
  }
  await admin.query('UPDATE organizations SET deleted_at = now() WHERE id = $1', [D]);
});

afterAll(async () => {
  await Promise.all([app.end(), support.end(), auth.end()]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('the columns', () => {
  it('starts a delivery due now and not claimed, and claims only a pending one (CHECK)', async () => {
    await clear();
    const place = where.get(A)!;
    const { rows } = await admin.query<{ due: boolean; claimed: string | null }>(
      `INSERT INTO message_deliveries (id, org_id, workspace_id, conversation_id, message_id, channel_account_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING next_attempt_at <= now() AS due, claimed_at AS claimed`,
      [uuidv7(), A, place.workspace, place.conversation, uuidv7(), place.channel],
    );
    expect(rows).toEqual([{ due: true, claimed: null }]);
    expect(await sqlState(put(A, { status: 'failed', claimed: '0' }))).toBe('23514');
    expect(await sqlState(put(A, { status: 'sent', claimed: '0' }))).toBe('23514');
  });
});

describe('the function', () => {
  it('is a SECURITY DEFINER function (not a view) with a fixed search_path, and returns only organisation ids', async () => {
    const fn = await admin.query<{ definer: boolean; vol: string; result: string; cfg: string[] }>(
      `SELECT prosecdef AS definer, provolatile AS vol, pg_get_function_result(oid) AS result, proconfig AS cfg
       FROM pg_proc WHERE proname = 'outbound_pending_orgs'`,
    );
    expect(fn.rows).toEqual([
      {
        definer: true,
        vol: 's',
        result: 'TABLE(org_id uuid)',
        cfg: ['search_path=pg_catalog, public, pg_temp'],
      },
    ]);
  });

  it('is executable by app_role only (not support_role, not auth_role, not PUBLIC)', async () => {
    const { rows } = await admin.query<{ r: string; ok: boolean }>(
      `SELECT r, has_function_privilege(r, 'app.outbound_pending_orgs(integer, integer)', 'EXECUTE') AS ok
       FROM unnest(ARRAY['app_role', 'auth_role', 'support_role', 'public']) AS r`,
    );
    expect(rows.filter((x) => x.ok).map((x) => x.r)).toEqual(['app_role']);
    const call = 'SELECT * FROM app.outbound_pending_orgs(10, 60)';
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
      await sqlState(app.query('SELECT * FROM app.outbound_pending_orgs($1, $2)', [limit, lease])),
    ).toBe('22023');
  });
});

describe('what counts as work', () => {
  it('names an organisation with a due pending delivery, and not one still waiting for its next attempt', async () => {
    await clear();
    await put(A);
    await put(B, { due: '5 minutes' });
    expect(await pending(10, 60)).toEqual([A]);
  });

  it('counts a claimed delivery only once its lease is over, whatever its next attempt', async () => {
    await clear();
    await put(B, { claimed: '-5 seconds' });
    expect(await pending(10, 60)).toEqual([]);
    await put(B, { claimed: '-5 minutes', due: '1 hour' });
    expect(await pending(10, 60)).toEqual([B]);
    expect(await pending(10, 3600)).toEqual([]);
  });

  it('does not count sent or failed deliveries, nor an organisation that is deleted', async () => {
    await clear();
    await put(A, { status: 'sent' });
    await put(A, { status: 'failed' });
    await put(D);
    expect(await pending(10, 60)).toEqual([]);
  });

  it('works without a tenant context, and the lease defaults to 60 seconds', async () => {
    await clear();
    await put(A);
    await put(B, { claimed: '-5 minutes' });
    await put(A, { claimed: '-5 seconds' });
    expect(await pending(10)).toEqual(await pending(10, 60));
    expect((await pending(10)).sort()).toEqual([A, B].sort());
  });
});

describe('order and limit', () => {
  it('names the organisation with the oldest work first, and cuts the list at p_limit', async () => {
    await clear();
    // Older than anything another spec could have left, so the cut cannot be taken by a stranger.
    await put(B, { due: '-3 years' });
    await put(A, { due: '-2 years' });
    expect(await pending(10, 60)).toEqual([B, A]);
    expect(await pending(1, 60)).toEqual([B]);
  });
});
