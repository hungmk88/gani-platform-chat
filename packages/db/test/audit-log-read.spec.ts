import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuditLogQuery,
  createDbPool,
  listAuditLogs,
  type TenantTx,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// listAuditLogs (A9a, GET /v1/audit-logs): the organisation is the tenant transaction's and never a filter (rule 1), so these tests
// are the wall between tenants as much as the check of the filters. The rows sit in the next two months, two partitions, after the
// row seedTenant writes now.
const [A, B] = [uuidv7(), uuidv7()];
const [ACTOR, OTHER] = [uuidv7(), uuidv7()];
const HOUR = 3_600_000;
const today = new Date();
const T = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 10);
const ids = { a1: uuidv7(), a2: uuidv7(), a3: uuidv7(), a4: uuidv7(), b1: uuidv7() };
// prettier-ignore
const rows: [id: string, org: string, actor: string | null, action: string, at: number][] = [
  [ids.a1, A, ACTOR, 'member.role_changed', T - 3 * HOUR],
  [ids.a2, A, ACTOR, 'customer.updated', T - 2 * HOUR],
  [ids.a3, A, OTHER, 'member.role_changed', T - HOUR],
  [ids.a4, A, null, 'workspace.updated', T + 31 * 24 * HOUR],
  [ids.b1, B, ACTOR, 'member.role_changed', T - HOUR / 2],
];
const seedUsers = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;

const read = async (org: string, query: Partial<AuditLogQuery> = {}) =>
  (
    await withTenant(pool, { orgId: org, workspaceIds: [] }, (tx) =>
      listAuditLogs(tx, { limit: 100, ...query }),
    )
  ).map((row) => row.id);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  for (const [id, org, actor, action, at] of rows)
    await admin.query(
      `INSERT INTO audit_logs (id, org_id, actor_user_id, action, target_type, target_id, detail, created_at)
       VALUES ($1, $2, $3, $4, 'member', $5, '{"from": "sales", "to": "manager"}', $6)`,
      [id, org, actor, action, uuidv7(), new Date(at)],
    );
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('listAuditLogs', () => {
  it('reads the log of the transaction’s organisation only, newest first across partitions', async () => {
    const seen = await read(A);
    expect(seen.slice(0, 4)).toEqual([ids.a4, ids.a3, ids.a2, ids.a1]);
    expect(seen).toHaveLength(5); // and the row seedTenant wrote, the oldest
    expect(seen).not.toContain(ids.b1);
    expect((await read(B)).slice(0, 1)).toEqual([ids.b1]);
    const [entry] = await withTenant(pool, { orgId: A, workspaceIds: [] }, (tx) =>
      listAuditLogs(tx, { actorUserId: OTHER, limit: 1 }),
    );
    expect(entry).toEqual({
      id: ids.a3,
      actorUserId: OTHER,
      action: 'member.role_changed',
      targetType: 'member',
      targetId: expect.any(String) as string,
      detail: { from: 'sales', to: 'manager' },
      createdAt: new Date(T - HOUR),
    });
  });

  it('filters by person, action and time (from included, to left out), and stops at the limit', async () => {
    expect(await read(A, { actorUserId: ACTOR })).toEqual([ids.a2, ids.a1]);
    expect(await read(A, { action: 'member.role_changed' })).toEqual([ids.a3, ids.a1]);
    expect(await read(A, { actorUserId: ACTOR, action: 'member.role_changed' })).toEqual([ids.a1]);
    const from = new Date(T - 2 * HOUR);
    expect(await read(A, { from, to: new Date(T - HOUR) })).toEqual([ids.a2]);
    expect(await read(A, { from })).toEqual([ids.a4, ids.a3, ids.a2]);
    expect(await read(A, { to: from })).toEqual([ids.a1, expect.any(String)]);
    expect(await read(A, { limit: 2 })).toEqual([ids.a4, ids.a3]);
    expect(await read(A, { action: 'nothing.done' })).toEqual([]);
  });

  it('refuses a wrong filter before it asks the database anything', async () => {
    const untouched = {} as TenantTx; // any query or context read on it would throw a TypeError of its own
    // prettier-ignore
    const wrong: [Partial<AuditLogQuery>, RegExp][] = [
      [{ limit: 0 }, /^limit must/], [{ limit: 101 }, /^limit must/], [{ limit: 1.5 }, /^limit must/],
      [{ action: ' ' }, /^action must/], [{ from: new Date('x') }, /^from must be a valid/], [{ to: new Date('x') }, /^to must be a valid/],
      [{ from: new Date(T), to: new Date(T) }, /^from must be before to$/], [{ actorUserId: 'x' }, /actorUserId is not a UUID/],
    ];
    for (const [query, message] of wrong)
      await expect(listAuditLogs(untouched, { limit: 10, ...query })).rejects.toThrow(message);
  });
});
