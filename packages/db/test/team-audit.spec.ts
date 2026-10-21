import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, insertAuditLog, shareTeam, withTenant } from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// shareTeam and insertAuditLog on app_role with RLS (the transfer of a conversation, Phụ lục B "Team", P9). seedTenant gives each
// organisation an owner in one team; MATE joins that team, GONE joined and left it, LONER is in another team.
const [A, B] = [uuidv7(), uuidv7()];
const [MATE, GONE, LONER] = [uuidv7(), uuidv7(), uuidv7()];
const owners = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;
const inOrg = <T>(org: string, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: org, workspaceIds: [] }, fn);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) owners.set(org, await seedTenant(admin, org));
  const team = (await admin.query<{ id: string }>('SELECT id FROM teams WHERE org_id = $1', [A]))
    .rows[0]?.id;
  const other = uuidv7();
  await admin.query(`INSERT INTO teams (id, org_id, name, slug) VALUES ($1, $2, 'O', 'other')`, [
    other,
    A,
  ]);
  for (const [who, inTeam, left] of [
    [MATE, team, false],
    [GONE, team, true],
    [LONER, other, false],
  ] as const) {
    await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
      who,
      `${who}@example.test`,
    ]);
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', 'active')`,
      [uuidv7(), A, who],
    );
    await admin.query(
      'INSERT INTO team_members (id, org_id, team_id, user_id, deleted_at) VALUES ($1, $2, $3, $4, $5)',
      [uuidv7(), A, inTeam, who, left ? new Date() : null],
    );
  }
});
afterAll(async () => {
  await pool.end();
  await admin.query('DELETE FROM team_members WHERE user_id = ANY($1::uuid[])', [
    [MATE, GONE, LONER],
  ]);
  await admin.query('DELETE FROM org_members WHERE user_id = ANY($1::uuid[])', [
    [MATE, GONE, LONER],
  ]);
  for (const [org, owner] of owners) await cleanupTenant(admin, org, owner);
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[MATE, GONE, LONER]]);
  await admin.end();
});

describe('shareTeam', () => {
  it('is true for two members of one team, false for a membership that ended, another team or another organisation', async () => {
    const owner = owners.get(A) as string;
    const share = (org: string, b: string) => inOrg(org, (tx) => shareTeam(tx, owner, b));
    expect(await share(A, MATE)).toBe(true);
    expect([await share(A, GONE), await share(A, LONER), await share(B, MATE)]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('insertAuditLog', () => {
  it('writes the row in the organisation of the tenant transaction, with its detail as given', async () => {
    const [id, target] = [uuidv7(), uuidv7()];
    const row = {
      id,
      actorUserId: MATE,
      action: 'conversation.transferred',
      targetType: 'conversation',
      targetId: target,
    };
    await inOrg(A, (tx) => insertAuditLog(tx, { ...row, detail: { toUserId: LONER, version: 2 } }));
    const { rows } = await admin.query(
      'SELECT org_id, action, detail FROM audit_logs WHERE id = $1',
      [id],
    );
    expect(rows).toEqual([
      { org_id: A, action: 'conversation.transferred', detail: { toUserId: LONER, version: 2 } },
    ]);
    await expect(
      inOrg(A, (tx) => insertAuditLog(tx, { ...row, id: 'x', detail: {} })),
    ).rejects.toThrow();
  });
});
