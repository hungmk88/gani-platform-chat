import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, resetMemberTwoFactor, withTenant } from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// app.reset_member_two_factor (Q-U20-1, N155) runs as its owner over three global tables, so these tests are the wall: one member of
// the current organisation only, never a person another organisation or the platform relies on, and nothing deleted.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const people: string[] = [];
let admin: pg.Client;
let app: pg.Client;
let support: pg.Client;
let pool: pg.Pool;

const OLD_REVOKE = new Date('2026-10-01T00:00:00Z');

/** A person with a confirmed, locked second factor and two live sessions and one ended, member of `org` (and of `also`). */
async function person(
  org: string,
  opts: {
    status?: string;
    also?: string;
    operator?: boolean;
    userDeleted?: boolean;
    memberDeleted?: boolean;
  } = {},
): Promise<{ user: string; member: string }> {
  const [user, member] = [uuidv7(), uuidv7()];
  people.push(user);
  // prettier-ignore
  await admin.query(
    `INSERT INTO users (id, email, status, two_factor_enabled, is_platform_operator, deleted_at)
     VALUES ($1, $2, 'active', true, $3, $4)`,
    [user, `${user}@example.test`, opts.operator ?? false, opts.userDeleted ? new Date() : null]);
  // prettier-ignore
  await admin.query(
    `INSERT INTO two_factors (id, user_id, secret, backup_codes, verified, failed_verification_count, locked_until)
     VALUES ($1, $2, 'secret', 'codes', true, 3, now() + interval '10 minutes')`,
    [uuidv7(), user]);
  for (const revoked of [null, null, OLD_REVOKE])
    await admin.query(
      `INSERT INTO sessions (id, user_id, token, expires_at, revoked_at) VALUES ($1, $2, $3, now() + interval '1 hour', $4)`,
      [uuidv7(), user, randomBytes(16).toString('hex'), revoked],
    );
  // prettier-ignore
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status, deleted_at) VALUES ($1, $2, $3, 'sales', $4, $5)`,
    [member, org, user, opts.status ?? 'active', opts.memberDeleted ? new Date() : null]);
  if (opts.also)
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'viewer', 'suspended')`,
      [uuidv7(), opts.also, user],
    );
  return { user, member };
}

/** The state of a person's second factor and sessions, to compare before and after. */
async function stateOf(user: string) {
  const { rows } = await admin.query(
    `SELECT u.two_factor_enabled, t.verified, t.failed_verification_count, t.locked_until IS NOT NULL AS locked, t.secret,
       (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS live,
       (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.revoked_at = $2) AS old_revoked
     FROM users u JOIN two_factors t ON t.user_id = u.id WHERE u.id = $1`,
    [user, OLD_REVOKE],
  );
  return rows[0] as Record<string, unknown>;
}
const UNTOUCHED = {
  two_factor_enabled: true,
  verified: true,
  failed_verification_count: 3,
  locked: true,
  live: 2,
  old_revoked: 1,
};

const reset = (org: string, member: string) =>
  withTenant(pool, { orgId: org, workspaceIds: [] }, (tx) => resetMemberTwoFactor(tx, member));

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  support = new pg.Client({ connectionString: url('support') });
  await Promise.all([admin.connect(), app.connect(), support.connect()]);
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
});

afterAll(async () => {
  await Promise.all([app.end(), support.end(), pool.end()]);
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  for (const table of ['sessions', 'two_factors', 'users'])
    await admin
      .query(
        `DELETE FROM ${table} WHERE ${table === 'users' ? 'id' : 'user_id'} = ANY($1::uuid[])`,
        [people],
      )
      .catch(() => undefined);
  await admin.end();
});

describe('app.reset_member_two_factor', () => {
  it('turns off the second factor of a member of the current org and ends their live sessions, deleting nothing', async () => {
    const { user, member } = await person(A, { status: 'suspended' });
    const bystander = await person(A);
    expect(await reset(A, member)).toBe('reset');
    expect(await stateOf(user)).toEqual({
      two_factor_enabled: false,
      verified: false,
      failed_verification_count: 0,
      locked: false,
      secret: 'secret', // the row stays; the next enable writes a new secret over it
      live: 0,
      old_revoked: 1, // an ended session keeps the time it ended
    });
    expect(await stateOf(bystander.user)).toMatchObject(UNTOUCHED);
  });

  it('finds nobody outside the current org, invitations, deleted members or deleted people, and changes nothing', async () => {
    const ofB = await person(B);
    const deletedMember = await person(A, { memberDeleted: true });
    const deletedUser = await person(A, { userDeleted: true });
    const pending = uuidv7();
    // prettier-ignore
    await admin.query(
      `INSERT INTO org_members (id, org_id, role, status, invited_email, invite_token_hash, invite_expires_at)
       VALUES ($1, $2, 'sales', 'pending', $3, $4, now() + interval '1 day')`,
      [pending, A, `${pending}@example.test`, randomBytes(32)]);
    for (const id of [ofB.member, deletedMember.member, deletedUser.member, pending, uuidv7()])
      expect(await reset(A, id)).toBe('not_found');
    for (const p of [ofB, deletedMember, deletedUser])
      expect(await stateOf(p.user)).toMatchObject(UNTOUCHED);
  });

  it('refuses a person who is also in another org (even suspended there) or a platform operator', async () => {
    const shared = await person(A, { also: B });
    const operator = await person(A, { operator: true });
    expect(await reset(A, shared.member)).toBe('shared');
    expect(await reset(A, operator.member)).toBe('shared');
    for (const p of [shared, operator]) expect(await stateOf(p.user)).toMatchObject(UNTOUCHED);
  });

  it('raises TN001 without a tenant context, and only app_role may call it', async () => {
    const { member } = await person(A);
    expect(await sqlState(app.query('SELECT app.reset_member_two_factor($1)', [member]))).toBe(
      'TN001',
    );
    expect(await sqlState(support.query('SELECT app.reset_member_two_factor($1)', [member]))).toBe(
      '42501',
    );
    const { rows } = await admin.query<Record<string, boolean>>(
      `SELECT has_function_privilege('app_role', 'app.reset_member_two_factor(uuid)', 'EXECUTE') AS app,
              has_function_privilege('auth_role', 'app.reset_member_two_factor(uuid)', 'EXECUTE') AS auth,
              has_function_privilege('public', 'app.reset_member_two_factor(uuid)', 'EXECUTE') AS public`,
    );
    expect(rows[0]).toEqual({ app: true, auth: false, public: false });
  });
});
