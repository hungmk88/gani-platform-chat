import { createHash, randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiKeys, createDbPool, withTenant, type TenantTx } from '../src/index.js';
import { sqlState, url } from './db.js';

// Spec RLS M01 §4.8: cases 2, 3 for api_keys, hash-only storage, column-level UPDATE and the column checks.
const [A, B, WA, WB] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const userIds: string[] = [];
let pool: pg.Pool;
let admin: pg.Client;
let uA: string;

const ctx = (orgId: string, workspaceIds: string[] = []) => ({ orgId, workspaceIds });
const keyIds = (tx: TenantTx) => tx.select({ id: apiKeys.id }).from(apiKeys);
const prefix = () => `gk_${randomBytes(4).toString('hex')}`;
const sha256 = (value: string) => createHash('sha256').update(value).digest();

interface KeyOver {
  workspace?: string | null;
  prefix?: string;
  hash?: Buffer;
  scopes?: (string | null)[];
  name?: string;
  by?: string | null;
}
function addKey(org: string, over: KeyOver = {}, id = uuidv7()) {
  const v = {
    workspace: null,
    prefix: prefix(),
    hash: randomBytes(32),
    scopes: ['conversations'],
    name: 'K',
    by: null,
    ...over,
  };
  return admin.query(
    `INSERT INTO api_keys (id, org_id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, org, v.workspace, v.name, v.prefix, v.hash, v.scopes, v.by],
  );
}

const keyRow = (org: string, over: Partial<typeof apiKeys.$inferInsert> = {}) => ({
  id: uuidv7(),
  orgId: org,
  name: 'K',
  keyPrefix: prefix(),
  keyHash: randomBytes(32),
  scopes: ['conversations'],
  ...over,
});

let KA = '';
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
  KA = uuidv7();
  await addKey(A, { workspace: WA }, KA);
  await addKey(B, { workspace: WB });
});

afterAll(async () => {
  await pool.end();
  for (const table of ['api_keys', 'workspaces', 'org_members']) {
    await admin.query(`DELETE FROM ${table} WHERE org_id = ANY($1::uuid[])`, [[A, B]]);
  }
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  await admin.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[A, B]]);
  await admin.end();
});

describe('isolation between tenants', () => {
  it('a tenant sees only its own keys', async () => {
    expect(await withTenant(pool, ctx(A), keyIds)).toEqual([{ id: KA }]);
  });

  it('case 2: a key for another org_id is refused (42501)', async () => {
    const insert = withTenant(pool, ctx(A), (tx) => tx.insert(apiKeys).values(keyRow(B)));
    expect(await sqlState(insert)).toBe('42501');
  });

  it('case 3: a key pointing at a workspace of another org is refused (23503)', async () => {
    const insert = withTenant(pool, ctx(A), (tx) =>
      tx.insert(apiKeys).values(keyRow(A, { workspaceId: WB })),
    );
    expect(await sqlState(insert)).toBe('23503');
  });

  it('a company-wide key (workspace_id NULL) is created and visible whatever workspaces the session holds', async () => {
    const row = keyRow(A);
    await withTenant(pool, ctx(A), (tx) => tx.insert(apiKeys).values(row));
    const seen = await withTenant(pool, ctx(A, [WA]), keyIds);
    expect(seen.map((r) => r.id)).toContain(row.id);
  });
});

describe('only the hash is stored', () => {
  it('keeps exactly the expected columns, none of which holds a key', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_keys' ORDER BY column_name",
    );
    const expected =
      'created_at created_by deleted_at expires_at id key_hash key_prefix last_used_at name org_id revoked_at scopes updated_at workspace_id';
    expect(rows.map((r) => r.column_name)).toEqual(expected.split(' '));
  });

  it('a stored row contains the prefix and the hash but not the key or its secret part', async () => {
    const [pre, secret] = [prefix(), randomBytes(24).toString('hex')];
    const row = keyRow(A, { keyPrefix: pre, keyHash: sha256(`${pre}${secret}`) });
    await withTenant(pool, ctx(A), (tx) => tx.insert(apiKeys).values(row));
    const { rows } = await admin.query<{ doc: string }>(
      'SELECT row_to_json(k)::text AS doc FROM api_keys k WHERE id = $1',
      [row.id],
    );
    const doc = rows[0]?.doc ?? '';
    expect(doc).toContain(pre);
    expect(doc).not.toContain(secret);
    expect(doc).not.toContain(`${pre}${secret}`);
  });

  it.each([0, 31, 33])('rejects a hash of %i bytes (23514)', async (size) => {
    expect(await sqlState(addKey(A, { hash: randomBytes(size) }))).toBe('23514');
  });

  it('accepts a hash of 32 bytes, and refuses a duplicate hash or prefix, also across orgs (23505)', async () => {
    const [hash, pre] = [randomBytes(32), prefix()];
    await addKey(A, { hash, prefix: pre });
    expect(await sqlState(addKey(B, { hash }))).toBe('23505');
    expect(await sqlState(addKey(B, { prefix: pre }))).toBe('23505');
  });
});

describe('column checks', () => {
  it.each<[string, KeyOver]>([
    ['upper case prefix', { prefix: 'gk_ABCDEFGH' }],
    ['7 character prefix body', { prefix: 'gk_abcdefg' }],
    ['9 character prefix body', { prefix: 'gk_abcdefghi' }],
    ['wrong prefix lead', { prefix: 'xx_abcdefgh' }],
    ['symbol in prefix', { prefix: 'gk_abcdefg!' }],
    ['blank name', { name: ' ' }],
    ['empty scopes', { scopes: [] }],
    ['NULL scope element', { scopes: ['conversations', null] }],
    ['7 character scope', { scopes: ['abcdefg'] }],
    ['33 character scope', { scopes: ['a'.repeat(33)] }],
  ])('rejects %s (23514)', async (_name, over) => {
    expect(await sqlState(addKey(A, over))).toBe('23514');
  });

  it('accepts scopes of 8 and 32 characters', async () => {
    await addKey(A, { scopes: ['a'.repeat(8), 'b'.repeat(32)] });
  });

  it('created_by must be a member of the same org (23503 otherwise)', async () => {
    await addKey(A, { by: uA });
    expect(await sqlState(addKey(B, { by: uA }))).toBe('23503');
  });
});

describe('api_key_scopes_valid', () => {
  it('is owned by migration_role, not SECURITY DEFINER, and app_role can execute it', async () => {
    const { rows } = await admin.query<{ owner: string; definer: boolean; app: boolean }>(
      `SELECT pg_get_userbyid(proowner) AS owner, prosecdef AS definer,
              has_function_privilege('app_role', oid, 'EXECUTE') AS app
       FROM pg_proc WHERE oid = 'public.api_key_scopes_valid(text[])'::regprocedure`,
    );
    expect(rows).toEqual([{ owner: 'migration_role', definer: false, app: true }]);
  });
});

describe('UPDATE by column', () => {
  const update = (set: Partial<typeof apiKeys.$inferInsert>) =>
    sqlState(
      withTenant(pool, ctx(A), (tx) => tx.update(apiKeys).set(set).where(eq(apiKeys.id, KA))),
    );

  it('lets app_role rename, revoke, rescope and touch a key', async () => {
    const set = {
      name: 'renamed',
      revokedAt: new Date(),
      lastUsedAt: new Date(),
      scopes: ['messages_read'],
    };
    expect(await update(set)).toBeUndefined();
  });

  it.each([
    ['key_hash', { keyHash: randomBytes(32) }],
    ['key_prefix', { keyPrefix: prefix() }],
    ['org_id', { orgId: B }],
  ])('refuses to change %s (42501)', async (_column, set) => {
    expect(await update(set)).toBe('42501');
  });
});
