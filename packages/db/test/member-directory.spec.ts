import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  listMembers,
  loadMember,
  setAgentCapacity,
  withTenant,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// app.org_member_directory (N153): like app.org_users it runs as its owner and bypasses RLS, so these tests are the wall between
// tenants. It shows the members of the current organisation that are not deleted, with their email, and never a token's hash.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const extraUsers: string[] = [];
let admin: pg.Client;
let app: pg.Client;
let support: pg.Client;
let pool: pg.Pool;

async function addMember(
  org: string,
  opts: { userDeleted?: boolean; memberDeleted?: boolean; status?: string; twoFactor?: boolean },
): Promise<{ member: string; email: string }> {
  const [id, member] = [uuidv7(), uuidv7()];
  const email = `${id}@example.test`;
  const pending = opts.status === 'pending';
  if (!pending) {
    extraUsers.push(id);
    // prettier-ignore
    await admin.query(
      `INSERT INTO users (id, email, status, display_name, two_factor_enabled, deleted_at) VALUES ($1, $2, 'active', 'N', $3, $4)`,
      [id, email, opts.twoFactor ?? false, opts.userDeleted ? new Date() : null]);
  }
  // prettier-ignore
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status, deleted_at, invited_email, invite_token_hash, invite_expires_at)
     VALUES ($1, $2, $3, 'sales', $4, $5, $6, $7, $8)`,
    [member, org, pending ? null : id, opts.status ?? 'active', opts.memberDeleted ? new Date() : null,
      pending ? email : null, pending ? randomBytes(32) : null, pending ? new Date(Date.now() + 86_400_000) : null]);
  return { member, email };
}

/** Runs `fn` in a transaction of app_role with org `org` as its context; always rolled back. */
async function asApp<T>(org: string | null, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    if (org) await app.query("SELECT set_config('app.current_org', $1, true)", [org]);
    return await fn();
  } finally {
    await app.query('ROLLBACK').catch(() => undefined);
  }
}
const rowsOf = async (org: string) =>
  (
    await asApp(org, () =>
      app.query<{ id: string; email: string; status: string; two_factor_enabled: boolean }>(
        'SELECT id, email, status, two_factor_enabled FROM app.org_member_directory',
      ),
    )
  ).rows;

const shown: { member: string; email: string }[] = [];
const hidden: string[] = [];
let ofB = '';

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  support = new pg.Client({ connectionString: url('support') });
  await Promise.all([admin.connect(), app.connect(), support.connect()]);
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  shown.push(
    await addMember(A, { twoFactor: true }),
    await addMember(A, { status: 'suspended' }),
    await addMember(A, { status: 'pending' }),
  );
  hidden.push(
    (await addMember(A, { userDeleted: true })).member,
    (await addMember(A, { memberDeleted: true })).member,
  );
  ofB = (await addMember(B, {})).member;
});

afterAll(async () => {
  await Promise.all([app.end(), support.end(), pool.end()]);
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin
    .query('DELETE FROM users WHERE id = ANY($1::uuid[])', [extraUsers])
    .catch(() => undefined);
  await admin.end();
});

describe('app.org_member_directory', () => {
  it('shows the active, suspended and invited members of the current org with their email, and nobody else', async () => {
    const rows = await rowsOf(A);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(rows).toHaveLength(4); // the seeded owner and the three above
    for (const { member, email } of shown) expect(byId.get(member)?.email).toBe(email);
    expect(byId.get(shown[0]!.member)).toMatchObject({
      status: 'active',
      two_factor_enabled: true,
    });
    expect(byId.get(shown[2]!.member)).toMatchObject({
      status: 'pending',
      two_factor_enabled: false,
    });
    for (const id of [...hidden, ofB]) expect(byId.has(id)).toBe(false);
    expect((await rowsOf(B)).map((r) => r.id)).toContain(ofB);
  });

  it('without a tenant context it raises TN001', async () => {
    expect(await sqlState(app.query('SELECT 1 FROM app.org_member_directory'))).toBe('TN001');
  });

  it('has exactly its columns: never the hash of an invitation token', async () => {
    const res = await asApp(A, () => app.query('SELECT * FROM app.org_member_directory LIMIT 0'));
    expect(res.fields.map((f) => f.name)).toEqual([
      'id',
      'org_id',
      'user_id',
      'email',
      'display_name',
      'role',
      'status',
      'two_factor_enabled',
      'invite_expires_at',
      'created_at',
      'max_concurrent_conversations',
    ]);
  });

  it('is read-only for app_role, closed to support_role, owned by migration_role and a security barrier', async () => {
    const { rows } = await admin.query<Record<string, unknown>>(
      `SELECT has_table_privilege('app_role', 'app.org_member_directory', 'INSERT') AS can_insert,
              has_table_privilege('app_role', 'app.org_member_directory', 'UPDATE') AS can_update,
              c.relowner::regrole::text AS owner, c.reloptions AS options
       FROM pg_class c WHERE c.oid = 'app.org_member_directory'::regclass`,
    );
    expect(rows[0]).toMatchObject({
      can_insert: false,
      can_update: false,
      owner: 'migration_role',
    });
    expect(rows[0]?.['options']).toContain('security_barrier=true');
    expect(await sqlState(support.query('SELECT 1 FROM app.org_member_directory'))).toBe('42501');
  });
});

describe('listMembers', () => {
  it('pages through the members oldest first, each once', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await withTenant(pool, { orgId: A, workspaceIds: [] }, (tx) =>
        listMembers(tx, { limit: 2, ...(cursor ? { cursor } : {}) }),
      );
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    expect(seen.slice(1)).toEqual(shown.map((s) => s.member));
  });
});

describe('setAgentCapacity (C9, N156)', () => {
  const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(pool, { orgId: A, workspaceIds: [] }, fn);

  it("makes the person's row the first time, then changes only its limit; the directory shows it, other orgs' rows never", async () => {
    const { member } = shown[0]!;
    const userId = (
      await admin.query<{ user_id: string }>('SELECT user_id FROM org_members WHERE id = $1', [
        member,
      ])
    ).rows[0]!.user_id;
    const capacity = async () =>
      (await inA((tx) => loadMember(tx, member)))?.maxConcurrentConversations;
    expect(await capacity()).toBeNull();
    expect(await inA((tx) => setAgentCapacity(tx, { id: uuidv7(), userId, max: 8 }))).toBeNull();
    expect(await inA((tx) => setAgentCapacity(tx, { id: uuidv7(), userId, max: 3 }))).toBe(8);
    expect(await capacity()).toBe(3);
    const rows = await admin.query('SELECT org_id FROM agent_settings WHERE user_id = $1', [
      userId,
    ]);
    expect(rows.rows).toEqual([{ org_id: A }]);
    // The seeded owner of B has a row of B's: it never shows in A, even for the same person (the join is on the member's org).
    const ownerB = seedUsers.get(B)!;
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', 'active')`,
      [uuidv7(), A, ownerB],
    );
    try {
      const byUser = new Map((await rowsOf(A)).map((r) => [r.id, r]));
      const inAOfB = (
        await admin.query<{ id: string }>(
          'SELECT id FROM org_members WHERE org_id = $1 AND user_id = $2',
          [A, ownerB],
        )
      ).rows[0]!.id;
      const viewed = await asApp(A, () =>
        app.query<{ max: number | null }>(
          'SELECT max_concurrent_conversations AS max FROM app.org_member_directory WHERE id = $1',
          [inAOfB],
        ),
      );
      expect(byUser.has(inAOfB)).toBe(true);
      expect(viewed.rows).toEqual([{ max: null }]);
    } finally {
      await admin.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [A, ownerB]);
    }
  });

  it('keeps the CHECK: a limit below 1 is refused by the database', async () => {
    const userId = seedUsers.get(A)!;
    await expect(
      inA((tx) => setAgentCapacity(tx, { id: uuidv7(), userId, max: 0 })),
    ).rejects.toThrow();
  });
});
