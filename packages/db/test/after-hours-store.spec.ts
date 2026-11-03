import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  afterHoursHeldConversations,
  afterHoursHeldOrgs,
  createDbPool,
  withTenant,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The conversations held outside business hours (C10-4b, N193): app.after_hours_held_orgs names the organisations that hold one,
// outside any tenant, ids only; through RLS (organisation and workspace) the job then reads the held conversations of one workspace. A holds two in
// its workspace and has one not held; B holds none; D is a deleted organisation that holds one. Results are cut down to the
// organisations of this spec, so rows another spec left cannot change them.
const [A, B, D] = [uuidv7(), uuidv7(), uuidv7()];
const orgs = [A, B, D];
const users = new Map<string, string>();
const workspace = new Map<string, string>();
const held: string[] = [];
let admin: pg.Client;
let support: pg.Client;
let pool: pg.Pool;

const put = async (org: string, hold: boolean) => {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state, after_hours_hold) VALUES ($1, $2, $3, 'BOT_ACTIVE', $4)`,
    [id, org, workspace.get(org), hold],
  );
  return id;
};
const heldIn = (org: string, ws: string, limit = 10, workspaceIds = [ws]) =>
  withTenant(pool, { orgId: org, workspaceIds }, (tx) =>
    afterHoursHeldConversations(tx, ws, limit),
  );

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  support = new pg.Client({ connectionString: url('support') });
  await Promise.all([admin.connect(), support.connect()]);
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of orgs) {
    users.set(org, await seedTenant(admin, org));
    const { rows } = await admin.query<{ id: string }>(
      'SELECT id FROM workspaces WHERE org_id = $1',
      [org],
    );
    workspace.set(org, rows[0]!.id);
  }
  held.push(await put(A, true), await put(A, true));
  await put(A, false);
  await put(D, true);
  await admin.query('UPDATE organizations SET deleted_at = now() WHERE id = $1', [D]);
});

afterAll(async () => {
  await Promise.all([pool.end(), support.end()]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('app.after_hours_held_orgs', () => {
  it('is SECURITY DEFINER and STABLE, pins its search_path, returns ids only; only app_role may run it', async () => {
    const fn = await admin.query(
      `SELECT prosecdef AS definer, provolatile AS vol, pg_get_function_result(oid) AS result, proconfig AS cfg
       FROM pg_proc WHERE proname = 'after_hours_held_orgs'`,
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
      `SELECT r, has_function_privilege(r, 'app.after_hours_held_orgs(integer)', 'EXECUTE') AS ok
       FROM unnest(ARRAY['app_role', 'auth_role', 'support_role', 'public']) AS r`,
    );
    expect(rows.filter((x) => x.ok).map((x) => x.r)).toEqual(['app_role']);
    expect(await sqlState(support.query('SELECT * FROM app.after_hours_held_orgs(10)'))).toBe(
      '42501',
    );
  });

  it.each([[0], [1001], [null]])('refuses limit %s (22023)', async (limit) => {
    expect(await sqlState(pool.query('SELECT * FROM app.after_hours_held_orgs($1)', [limit]))).toBe(
      '22023',
    );
  });

  it('names an organisation that holds a conversation; not one that holds none, nor a deleted one', async () => {
    expect((await afterHoursHeldOrgs(pool, 1000)).filter((o) => orgs.includes(o))).toEqual([A]);
  });

  it('uses the partial index of the held conversations', async () => {
    const { rows } = await admin.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'conversations_after_hours_idx'`,
    );
    expect(rows[0]?.indexdef).toMatch(/\(org_id, workspace_id, id\) WHERE after_hours_hold/);
  });
});

describe('the held conversations of a workspace, through RLS', () => {
  it('lists them by id up to a limit; none outside the tenant’s workspaces, none of another organisation', async () => {
    const [wa, wb] = [workspace.get(A)!, workspace.get(B)!];
    expect(await heldIn(A, wa)).toEqual([...held].sort());
    expect(await heldIn(A, wa, 1)).toEqual([[...held].sort()[0]]);
    expect(await heldIn(A, wa, 10, [])).toEqual([]);
    expect(await heldIn(B, wb)).toEqual([]);
    expect(await heldIn(B, wa, 10, [wa])).toEqual([]);
  });
});
