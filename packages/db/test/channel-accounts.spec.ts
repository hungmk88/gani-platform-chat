import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { channelAccounts, createDbPool, withTenant } from '../src/index.js';
import { sqlState, url } from './db.js';

// channel_accounts (zalo-channel-spec §1): isolation by organisation, the partial unique key, the checks, UPDATE by column, and which
// columns each role can read. The row-level rules of every table (ENABLE + FORCE, the two policies, no DELETE, TN001) are covered for
// this one too by rls-all-tables.spec and support-access.spec, which read the catalog.
const [A, B, WA, WB] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const AX = uuidv7();
const userIds: string[] = [];
let pool: pg.Pool;
let admin: pg.Client;
let uA: string;

const ctx = (orgId: string) => ({ orgId, workspaceIds: [] as string[] });
const cipher = (size = 32) => randomBytes(size);
const oa = () => `oa-${randomBytes(6).toString('hex')}`;

interface AccountOver {
  workspace?: string;
  type?: string;
  external?: string;
  name?: string;
  status?: string;
  keyVersion?: number;
  lastError?: string | null;
  secret?: Buffer | null;
  by?: string | null;
  deletedAt?: Date | null;
}
function addAccount(org: string, ws: string, over: AccountOver = {}, id = uuidv7()) {
  const v = {
    workspace: ws,
    type: 'zalo_oa',
    external: oa(),
    name: 'OA',
    status: 'disconnected',
    keyVersion: 1,
    lastError: null,
    secret: null,
    by: null,
    deletedAt: null,
    ...over,
  };
  return admin.query(
    `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, status, key_version, last_error, oa_secret_key_enc, created_by, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      org,
      v.workspace,
      v.type,
      v.external,
      v.name,
      v.status,
      v.keyVersion,
      v.lastError,
      v.secret,
      v.by,
      v.deletedAt,
    ],
  );
}
const insertAs = (
  org: string,
  ws: string,
  over: Partial<typeof channelAccounts.$inferInsert> = {},
) =>
  withTenant(pool, ctx(org), (tx) =>
    tx.insert(channelAccounts).values({
      id: uuidv7(),
      orgId: org,
      workspaceId: ws,
      type: 'zalo_oa',
      externalAccountId: oa(),
      displayName: 'OA',
      ...over,
    }),
  );

beforeAll(async () => {
  pool = createDbPool(url('app'), { max: 2 });
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  for (const id of [A, B]) {
    await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
      id,
      `t-${id}`,
      'Test',
    ]);
  }
  uA = uuidv7();
  const uB = uuidv7();
  userIds.push(uA, uB);
  for (const [user, org] of [
    [uA, A],
    [uB, B],
  ] as const) {
    await admin.query("INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')", [
      user,
      `${user}@example.test`,
    ]);
    await admin.query(
      "INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'viewer', 'active')",
      [uuidv7(), org, user],
    );
  }
  for (const [org, ws] of [
    [A, WA],
    [B, WB],
  ] as const) {
    await admin.query(
      "INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws', 'W', 'service')",
      [ws, org],
    );
  }
  await addAccount(A, WA, { secret: cipher() }, AX);
  await addAccount(B, WB);
});

afterAll(async () => {
  await pool.end();
  for (const table of ['channel_accounts', 'workspaces', 'org_members']) {
    await admin.query(`DELETE FROM ${table} WHERE org_id = ANY($1::uuid[])`, [[A, B]]);
  }
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  await admin.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[A, B]]);
  await admin.end();
});

describe('isolation between tenants', () => {
  it('a tenant sees only its own accounts', async () => {
    const seen = await withTenant(pool, ctx(A), (tx) =>
      tx.select({ id: channelAccounts.id }).from(channelAccounts),
    );
    expect(seen.map((r) => r.id)).toContain(AX);
    expect(seen.length).toBe(
      (await admin.query('SELECT 1 FROM channel_accounts WHERE org_id = $1', [A])).rowCount,
    );
  });

  it('an account for another org_id is refused (42501)', async () => {
    expect(await sqlState(insertAs(A, WA, { orgId: B }))).toBe('42501');
  });

  it('an account pointing at a workspace of another org is refused (23503)', async () => {
    expect(await sqlState(insertAs(A, WB))).toBe('23503');
  });

  it('created_by must be a member of the same org (23503 otherwise)', async () => {
    await addAccount(A, WA, { by: uA });
    expect(await sqlState(addAccount(B, WB, { by: uA }))).toBe('23503');
  });
});

describe('the key of an account at the platform', () => {
  it('is unique among live accounts, across orgs (23505)', async () => {
    const external = oa();
    await addAccount(A, WA, { external });
    expect(await sqlState(addAccount(B, WB, { external }))).toBe('23505');
    expect(await sqlState(addAccount(A, WA, { external }))).toBe('23505');
  });

  it('is free again once the account is soft deleted, so the same OA can be connected again', async () => {
    const [external, id] = [oa(), uuidv7()];
    await addAccount(A, WA, { external }, id);
    await withTenant(pool, ctx(A), (tx) =>
      tx.update(channelAccounts).set({ deletedAt: new Date() }).where(eq(channelAccounts.id, id)),
    );
    await addAccount(B, WB, { external });
    expect(await sqlState(addAccount(A, WA, { external }))).toBe('23505');
  });

  it('the same type may appear twice in a workspace, and different types may share an id', async () => {
    await addAccount(A, WA);
    await addAccount(A, WA);
    const external = oa();
    await addAccount(A, WA, { external });
    await addAccount(A, WA, { external, type: 'facebook' });
  });
});

describe('column checks', () => {
  it.each<[string, AccountOver]>([
    ['unknown type', { type: 'telegram' }],
    ['blank external id', { external: ' ' }],
    ['blank name', { name: ' ' }],
    ['unknown status', { status: 'ok' }],
    ['key_version 0', { keyVersion: 0 }],
    ['blank last_error', { lastError: ' ' }],
    ['last_error of 65 characters', { lastError: 'x'.repeat(65) }],
    ['a secret of 27 bytes', { secret: cipher(27) }],
    ['an empty secret', { secret: cipher(0) }],
  ])('rejects %s (23514)', async (_name, over) => {
    expect(await sqlState(addAccount(A, WA, over))).toBe('23514');
  });

  it('accepts a secret of 28 bytes, no secret, a last_error of 64 characters and every status and type', async () => {
    await addAccount(A, WA, { secret: cipher(28) });
    await addAccount(A, WA, { lastError: 'x'.repeat(64) });
    for (const status of ['connected', 'token_expiring', 'disconnected'])
      await addAccount(A, WA, { status });
    for (const type of ['zalo_oa', 'facebook', 'webchat']) await addAccount(A, WA, { type });
  });
});

describe('UPDATE by column', () => {
  const update = (set: Partial<typeof channelAccounts.$inferInsert>) =>
    sqlState(
      withTenant(pool, ctx(A), (tx) =>
        tx.update(channelAccounts).set(set).where(eq(channelAccounts.id, AX)),
      ),
    );

  it('lets app_role rename an account, replace its secrets and tokens, move its state and soft delete it', async () => {
    const id = uuidv7();
    await addAccount(A, WA, {}, id);
    const set = {
      displayName: 'Renamed',
      appSecretEnc: cipher(),
      oaSecretKeyEnc: cipher(),
      accessTokenEnc: cipher(),
      refreshTokenEnc: cipher(),
      keyVersion: 2,
      accessTokenExpiresAt: new Date(),
      refreshTokenExpiresAt: new Date(),
      lastRefreshedAt: new Date(),
      refreshClaimedAt: new Date(),
      status: 'connected',
      lastError: 'E_X',
      deletedAt: new Date(),
      updatedAt: new Date(),
    };
    await withTenant(pool, ctx(A), (tx) =>
      tx.update(channelAccounts).set(set).where(eq(channelAccounts.id, id)),
    );
    const { rows } = await admin.query<{ display_name: string; key_version: number }>(
      'SELECT display_name, key_version FROM channel_accounts WHERE id = $1',
      [id],
    );
    expect(rows).toEqual([{ display_name: 'Renamed', key_version: 2 }]);
  });

  it.each<[string, Partial<typeof channelAccounts.$inferInsert>]>([
    ['org_id', { orgId: B }],
    ['workspace_id', { workspaceId: WA }],
    ['type', { type: 'facebook' }],
    ['external_account_id', { externalAccountId: 'other' }],
    ['app_id', { appId: 'other' }],
    ['created_by', { createdBy: uA }],
    ['created_at', { createdAt: new Date() }],
    ['id', { id: uuidv7() }],
  ])('refuses to change %s (42501)', async (_column, set) => {
    expect(await update(set)).toBe('42501');
  });

  it('refuses a plain secret that is too short, as the insert does (23514)', async () => {
    expect(await update({ accessTokenEnc: cipher(10) })).toBe('23514');
  });
});

describe('what each role may read and change, from the catalog', () => {
  const SECRETS = ['app_secret_enc', 'oa_secret_key_enc', 'access_token_enc', 'refresh_token_enc'];
  const columns = async () =>
    (
      await admin.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'channel_accounts' ORDER BY ordinal_position",
      )
    ).rows.map((r) => r.column_name);
  const privilege = async (role: string, column: string, kind: 'SELECT' | 'UPDATE') =>
    (
      await admin.query<{ ok: boolean }>('SELECT has_column_privilege($1, $2, $3, $4) AS ok', [
        role,
        'public.channel_accounts',
        column,
        kind,
      ])
    ).rows[0]?.ok;

  it('keeps exactly the expected columns: a new one has to be looked at here', async () => {
    const expected =
      'id org_id workspace_id type external_account_id display_name app_id app_secret_enc oa_secret_key_enc access_token_enc refresh_token_enc key_version access_token_expires_at refresh_token_expires_at last_refreshed_at refresh_claimed_at status last_error created_by deleted_at created_at updated_at';
    expect(await columns()).toEqual(expected.split(' '));
  });

  it('support_role reads every column except the four secrets, and changes none', async () => {
    for (const column of await columns()) {
      expect(await privilege('support_role', column, 'SELECT'), column).toBe(
        !SECRETS.includes(column),
      );
      expect(await privilege('support_role', column, 'UPDATE'), column).toBe(false);
    }
  });

  it('app_role reads every column and changes exactly the columns of the grant', async () => {
    const mayChange = new Set([
      'display_name',
      ...SECRETS,
      'key_version',
      'access_token_expires_at',
      'refresh_token_expires_at',
      'last_refreshed_at',
      'refresh_claimed_at',
      'status',
      'last_error',
      'deleted_at',
      'updated_at',
    ]);
    for (const column of await columns()) {
      expect(await privilege('app_role', column, 'SELECT'), column).toBe(true);
      expect(await privilege('app_role', column, 'UPDATE'), column).toBe(mayChange.has(column));
    }
  });
});
