import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  beginIdempotent,
  completeIdempotent,
  createDbPool,
  failIdempotent,
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
