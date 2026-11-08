import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, slaRunningOrgs } from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The organisations whose SLA clock the opening hours move (E4b, N211): app.sla_running_orgs names those with a running SLA or one
// paused outside the hours, outside any tenant, ids only. R has a running SLA; O one paused outside the hours; W only one waiting for
// the customer; N none; D is a deleted organisation with a running SLA. Results are cut down to the organisations of this spec, so
// rows another spec left cannot change them.
const [R, O, W, N, D] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const orgs = [R, O, W, N, D];
const users = new Map<string, string>();
let admin: pg.Client;
let support: pg.Client;
let pool: pg.Pool;

const due = new Date('2026-11-03T03:00:00.000Z');
const setSla = (org: string, reason: string | null, remaining: number | null) =>
  admin.query(
    `UPDATE conversations SET sla_due_at = $2, sla_paused_reason = $3, sla_remaining_seconds = $4 WHERE org_id = $1`,
    [org, due, reason, remaining],
  );
const named = async () => (await slaRunningOrgs(pool, 1000)).filter((o) => orgs.includes(o));

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  support = new pg.Client({ connectionString: url('support') });
  await Promise.all([admin.connect(), support.connect()]);
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of orgs) users.set(org, await seedTenant(admin, org));
  await setSla(R, null, null);
  await setSla(O, 'outside_hours', 1800);
  await setSla(W, 'waiting_customer', 600);
  await setSla(D, null, null);
  await admin.query('UPDATE organizations SET deleted_at = now() WHERE id = $1', [D]);
});

afterAll(async () => {
  await Promise.all([pool.end(), support.end()]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('app.sla_running_orgs', () => {
  it('is SECURITY DEFINER and STABLE, pins its search_path, returns ids only; only app_role may run it', async () => {
    const fn = await admin.query(
      `SELECT prosecdef AS definer, provolatile AS vol, pg_get_function_result(oid) AS result, proconfig AS cfg
       FROM pg_proc WHERE proname = 'sla_running_orgs'`,
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
      `SELECT r, has_function_privilege(r, 'app.sla_running_orgs(integer)', 'EXECUTE') AS ok
       FROM unnest(ARRAY['app_role', 'auth_role', 'support_role', 'public']) AS r`,
    );
    expect(rows.filter((x) => x.ok).map((x) => x.r)).toEqual(['app_role']);
    expect(await sqlState(support.query('SELECT * FROM app.sla_running_orgs(10)'))).toBe('42501');
  });

  it.each([[0], [1001], [null]])('refuses limit %s (22023)', async (limit) => {
    expect(await sqlState(pool.query('SELECT * FROM app.sla_running_orgs($1)', [limit]))).toBe(
      '22023',
    );
  });

  it('names an organisation with a running SLA and one with an SLA paused outside the hours', async () => {
    expect(await named()).toEqual([R, O].sort());
  });

  it('does not name one whose only pause is the customer’s, one with no SLA, nor a deleted one', async () => {
    const left = await named();
    expect(left).not.toContain(W);
    expect(left).not.toContain(N);
    expect(left).not.toContain(D);
  });

  it('stops at the limit, by id', async () => {
    const all = await slaRunningOrgs(pool, 1000);
    expect(await slaRunningOrgs(pool, 1)).toEqual(all.slice(0, 1));
  });
});
