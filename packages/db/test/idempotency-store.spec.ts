import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  beginIdempotent,
  completeIdempotent,
  createDbPool,
  failIdempotent,
  purgeIdempotencyKeys,
  withTenant,
  type IdempotencyRequest,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Idempotency-Key (Brief P9, N134): the first request claims the key, its answer is given back to the same request sent again, another
// request with the key is refused, and a key that expired, failed or was left in progress by a dead process can be used again.
const [A, B] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;
let me = '';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const req = (key: string, over: Partial<IdempotencyRequest> = {}): IdempotencyRequest => ({
  userId: me,
  key,
  method: 'POST',
  path: '/v1/conversations/x/claim',
  requestHash: hash(1),
  ...over,
});
const inOrg = <T>(org: string, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: org, workspaceIds: [] }, fn);
const begin = (r: IdempotencyRequest, org = A) => inOrg(org, (tx) => beginIdempotent(tx, r));
const complete = (key: string, status: number, body: unknown) =>
  inOrg(A, (tx) => completeIdempotent(tx, { userId: me, key, status, body }));
const age = (key: string, column: 'created_at' | 'updated_at', interval: string) =>
  admin.query(`UPDATE idempotency_keys SET ${column} = now() - $2::interval WHERE key = $1`, [
    key,
    interval,
  ]);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  me = users.get(A) as string;
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', 'active')`,
    [uuidv7(), B, me],
  );
});
afterAll(async () => {
  await pool.end();
  await admin.query('DELETE FROM idempotency_keys WHERE org_id = ANY($1::uuid[])', [[A, B]]);
  await admin.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [B, me]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('beginIdempotent and completeIdempotent', () => {
  it('claims a new key, answers in_progress while it runs, then gives back the kept answer', async () => {
    const key = uuidv7();
    expect(await begin(req(key))).toEqual({ kind: 'new' });
    expect(await begin(req(key))).toEqual({ kind: 'in_progress' });
    expect(await complete(key, 200, { id: 'c1', state: 'HUMAN_ACTIVE' })).toBe(true);
    expect(await begin(req(key))).toEqual({
      kind: 'replay',
      status: 200,
      body: { id: 'c1', state: 'HUMAN_ACTIVE' },
    });
    expect(await complete(key, 200, {})).toBe(false);
  });

  it('keeps a 4xx answer too, and refuses the key for another request (method, path or body)', async () => {
    const key = uuidv7();
    await begin(req(key));
    await complete(key, 409, { code: 'conversation_already_claimed' });
    expect(await begin(req(key))).toMatchObject({ kind: 'replay', status: 409 });
    for (const other of [
      { requestHash: hash(2) },
      { path: '/v1/conversations/y/claim' },
      { method: 'PUT' },
    ])
      expect(await begin(req(key, other)), JSON.stringify(other)).toEqual({ kind: 'mismatch' });
  });

  it('lets the key be used again after a failure, after a process died with it in progress, and after 24 hours', async () => {
    const [failed, stuck, old] = [uuidv7(), uuidv7(), uuidv7()];
    for (const key of [failed, stuck, old]) await begin(req(key));
    await inOrg(A, (tx) => failIdempotent(tx, { userId: me, key: failed }));
    expect(await begin(req(failed))).toEqual({ kind: 'new' });
    await age(stuck, 'updated_at', '2 minutes');
    expect(await begin(req(stuck))).toEqual({ kind: 'new' });
    await complete(old, 200, {});
    await age(old, 'created_at', '25 hours');
    // Expired: even another request may take the key, and the old answer is gone.
    expect(await begin(req(old, { requestHash: hash(3) }))).toEqual({ kind: 'new' });
    expect(await begin(req(old, { requestHash: hash(3) }))).toEqual({ kind: 'in_progress' });
  });

  it('scopes a key to the person and the organisation', async () => {
    const key = uuidv7();
    await begin(req(key));
    await complete(key, 201, { n: 1 });
    expect(await begin(req(key, { userId: users.get(B) as string }), B)).toEqual({ kind: 'new' });
    expect(await begin(req(key), B)).toEqual({ kind: 'new' });
    expect(await begin(req(key))).toMatchObject({ kind: 'replay', status: 201 });
  });

  it('keeps no 5xx and no answer while in progress (CHECK), and refuses a key that is not printable ASCII', async () => {
    await expect(complete(uuidv7(), 500, {})).rejects.toBeInstanceOf(RangeError);
    const insert = (status: string, code: number | null, key = uuidv7()) =>
      admin.query(
        `INSERT INTO idempotency_keys (org_id, user_id, key, method, path, request_hash, status, response_status) VALUES ($1, $2, $3, 'POST', '/v1/x', $4, $5, $6)`,
        [A, me, key, hash(1), status, code],
      );
    expect(await sqlState(insert('done', 503))).toBe('23514');
    expect(await sqlState(insert('in_progress', 200))).toBe('23514');
    expect(await sqlState(insert('done', null))).toBe('23514');
    expect(await sqlState(insert('in_progress', null, 'has space'))).toBe('23514');
  });
});

// The policy idempotency_keys_app itself, in SQL of A's own: the store sets and filters org_id by itself, so the cases above stay green
// without it. B's seed key holds a kept answer, which may name a customer.
describe('idempotency_keys_app: A neither reads, writes nor changes a key of B', () => {
  const where = 'org_id = $1 AND user_id = $2 AND key = $3';
  const theirs = () => [B, users.get(B) as string, 'seed'];
  const kept = { customer: { email: 'b@example.test' } };
  /** One statement as app_role in the tenant of A, committed. */
  async function asA(text: string, params: unknown[]): Promise<pg.QueryResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [A]);
      const result = await client.query(text, params);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  beforeAll(async () => {
    const { rowCount } = await admin.query(
      `UPDATE idempotency_keys SET status = 'done', response_status = 200, response_body = $4 WHERE ${where}`,
      [...theirs(), kept],
    );
    expect(rowCount, 'B must hold its seed key, or 0 rows proves nothing').toBe(1);
  });

  it('reads no kept answer of B (USING)', async () => {
    expect(
      (await asA(`SELECT response_body FROM idempotency_keys WHERE ${where}`, theirs())).rows,
    ).toEqual([]);
  });

  it('writes no key for B: 42501 (WITH CHECK)', async () => {
    const insert = `INSERT INTO idempotency_keys (org_id, user_id, key, method, path, request_hash) VALUES ($1, $2, $3, 'POST', '/v1/x', $4)`;
    expect(await sqlState(asA(insert, [B, users.get(B), uuidv7(), hash(1)]))).toBe('42501');
  });

  it('changes no key of B: 0 rows, and B keeps its answer (USING)', async () => {
    const update = `UPDATE idempotency_keys SET status = 'failed', response_status = NULL, response_body = NULL WHERE ${where}`;
    expect((await asA(update, theirs())).rowCount).toBe(0);
    const { rows } = await admin.query(
      `SELECT status, response_body FROM idempotency_keys WHERE ${where}`,
      theirs(),
    );
    expect(rows).toEqual([{ status: 'done', response_body: kept }]);
  });
});

describe('purgeIdempotencyKeys (app.purge_idempotency_keys)', () => {
  it('removes the keys older than 24 hours of every organisation, in batches, and keeps the others', async () => {
    const [oldA, oldB, fresh] = [uuidv7(), uuidv7(), uuidv7()];
    await begin(req(oldA));
    await begin(req(oldB, { userId: users.get(B) as string }), B);
    await begin(req(fresh));
    for (const key of [oldA, oldB]) await age(key, 'created_at', '25 hours');
    await age(fresh, 'created_at', '23 hours');
    let removed = 0;
    for (
      let n = await purgeIdempotencyKeys(pool, 24, 1);
      n > 0;
      n = await purgeIdempotencyKeys(pool, 24, 1)
    ) {
      expect(n).toBe(1);
      removed += n;
    }
    expect(removed).toBeGreaterThanOrEqual(2);
    const { rows } = await admin.query('SELECT key FROM idempotency_keys WHERE key = ANY($1)', [
      [oldA, oldB, fresh],
    ]);
    expect(rows).toEqual([{ key: fresh }]);
  });

  it('refuses less than 24 hours and a batch outside 1..10000 (22023), and is not for support_role', async () => {
    for (const [hours, limit] of [
      [23, 10],
      [24, 0],
      [24, 10_001],
    ] as const)
      expect(await sqlState(purgeIdempotencyKeys(pool, hours, limit)), `${hours} ${limit}`).toBe(
        '22023',
      );
    const { rows } = await admin.query<{ ok: boolean }>(
      `SELECT has_function_privilege('support_role', 'app.purge_idempotency_keys(integer, integer)', 'EXECUTE') AS ok`,
    );
    expect(rows).toEqual([{ ok: false }]);
  });
});
