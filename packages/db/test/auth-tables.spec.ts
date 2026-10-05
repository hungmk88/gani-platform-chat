import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// PR6a (spec RLS M01 §3.1-3.2, §7 cases 7, 8, 19): the auth tables are global, so GRANT by column is the only wall.
// auth_role does what a sign-in needs and nothing more; app_role and support_role reach none of it.
const AUTH_TABLES = ['users', 'sessions', 'accounts', 'verifications', 'two_factors'];
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNo';
const [A, B] = [uuidv7(), uuidv7()];
const tag = `t-${uuidv7()}`;
let UA = '';
let UB = '';
let admin: pg.Client;
let auth: pg.Client;
let app: pg.Client;
let support: pg.Client;

const token = () => randomBytes(16).toString('hex');
const session = (user: string, opts: { org?: string; hours?: number; token?: string } = {}) =>
  auth.query(
    `INSERT INTO sessions (id, user_id, token, expires_at, active_org_id)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4::int), $5)`,
    [uuidv7(), user, opts.token ?? token(), opts.hours ?? 11, opts.org ?? null],
  );
const account = (user: string, password: string, provider = 'credential') =>
  auth.query(
    'INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, $4, $5)',
    [uuidv7(), user, `${tag}-${user}`, provider, password],
  );
const twoFactor = (user: string) =>
  auth.query(
    'INSERT INTO two_factors (id, user_id, secret, backup_codes) VALUES ($1, $2, $3, $4)',
    [uuidv7(), user, 'secret', 'codes'],
  );

beforeAll(async () => {
  [admin, auth, app, support] = [
    new pg.Client({ connectionString: url('migration') }),
    new pg.Client({ connectionString: url('auth') }),
    new pg.Client({ connectionString: url('app') }),
    new pg.Client({ connectionString: url('support') }),
  ];
  await Promise.all([admin.connect(), auth.connect(), app.connect(), support.connect()]);
  UA = await seedTenant(admin, A);
  UB = await seedTenant(admin, B);
});

afterAll(async () => {
  await Promise.all([auth.end(), app.end(), support.end()]);
  const mine = [UA, UB];
  for (const t of ['two_factors', 'accounts', 'sessions']) {
    await admin
      .query(`DELETE FROM ${t} WHERE user_id = ANY($1::uuid[])`, [mine])
      .catch(() => undefined);
  }
  await admin
    .query('DELETE FROM verifications WHERE identifier = $1', [tag])
    .catch(() => undefined);
  await cleanupTenant(admin, A, UA);
  await cleanupTenant(admin, B, UB);
  await admin.end();
});

describe('case 7: app_role and support_role have no way into the auth tables', () => {
  it.each(AUTH_TABLES)('%s: SELECT is refused (42501)', async (table) => {
    expect(await sqlState(app.query(`SELECT 1 FROM ${table}`))).toBe('42501');
    expect(await sqlState(support.query(`SELECT 1 FROM ${table}`))).toBe('42501');
  });
});

describe('case 8: auth_role is limited by column', () => {
  it('reads the listed columns of users and nothing else (42501)', async () => {
    const cols =
      'id, email, email_verified_at, status, two_factor_enabled, locked_until, created_at, updated_at';
    const { rows } = await auth.query(`SELECT ${cols} FROM users WHERE id = $1`, [UA]);
    expect(rows).toHaveLength(1);
    expect(await sqlState(auth.query('SELECT pending_password_since FROM users'))).toBe('42501');
    expect(await sqlState(auth.query('SELECT * FROM users'))).toBe('42501');
  });

  it('updates failed_login_count and locked_until, but not email, status or who is an operator (42501)', async () => {
    const ok = await auth.query(
      "UPDATE users SET failed_login_count = 3, locked_until = now() + interval '30 minutes' WHERE id = $1",
      [UA],
    );
    expect(ok.rowCount).toBe(1);
    for (const column of [
      'email',
      'status',
      'email_verified_at',
      'is_platform_operator',
      'pending_password_since',
    ]) {
      expect(await sqlState(auth.query(`UPDATE users SET ${column} = ${column}`)), column).toBe(
        '42501',
      );
    }
  });

  it('has no privilege on any business table', async () => {
    for (const t of [
      'organizations',
      'org_members',
      'workspaces',
      'conversations',
      'api_keys',
      'audit_logs',
    ]) {
      expect(await sqlState(auth.query(`SELECT 1 FROM ${t}`)), t).toBe('42501');
    }
  });
});

describe('case 19: what auth_role may not do', () => {
  it('cannot INSERT into users, nor DELETE from any auth table (42501)', async () => {
    expect(
      await sqlState(
        auth.query(
          `INSERT INTO users (id, email, status) VALUES ($1, 'x@example.test', 'active')`,
          [uuidv7()],
        ),
      ),
    ).toBe('42501');
    for (const t of AUTH_TABLES)
      expect(await sqlState(auth.query(`DELETE FROM ${t} WHERE false`)), t).toBe('42501');
  });

  it('cannot extend a session or move it to another person, nor change who owns an account (42501)', async () => {
    await session(UA);
    for (const text of [
      "UPDATE sessions SET expires_at = expires_at + interval '1 hour'",
      'UPDATE sessions SET user_id = user_id',
      'UPDATE sessions SET token = token',
      'UPDATE accounts SET user_id = user_id',
      'UPDATE two_factors SET user_id = user_id',
    ]) {
      expect(await sqlState(auth.query(text)), text).toBe('42501');
    }
  });
});

describe('what a sign-in needs', () => {
  it('creates a session and revokes it (revoked_at), keeping the row', async () => {
    const t = token();
    await session(UA, { token: t });
    const revoke = await auth.query(
      'UPDATE sessions SET revoked_at = now(), updated_at = now() WHERE token = $1',
      [t],
    );
    expect(revoke.rowCount).toBe(1);
    const { rows } = await auth.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM sessions WHERE token = $1',
      [t],
    );
    expect(rows[0]?.revoked_at).not.toBeNull();
  });

  it('stores a credential, a one-time token and a 2FA enrolment, and updates the allowed columns', async () => {
    await account(UA, HASH);
    expect(
      (
        await auth.query(
          'UPDATE accounts SET password = $1, updated_at = now() WHERE user_id = $2',
          [HASH, UA],
        )
      ).rowCount,
    ).toBe(1);
    const id = uuidv7();
    await auth.query(
      "INSERT INTO verifications (id, identifier, value, expires_at) VALUES ($1, $2, 'hash', now() + interval '24 hours')",
      [id, tag],
    );
    expect(
      (await auth.query('UPDATE verifications SET used_at = now() WHERE id = $1', [id])).rowCount,
    ).toBe(1);
    await twoFactor(UA);
    expect(
      (await auth.query("UPDATE two_factors SET backup_codes = 'new' WHERE user_id = $1", [UA]))
        .rowCount,
    ).toBe(1);
  });
});

describe('constraints', () => {
  it('caps a session at 12 hours and refuses one that ends before it starts (23514)', async () => {
    expect(await sqlState(session(UB, { hours: 13 }))).toBe('23514');
    expect(await sqlState(session(UB, { hours: -1 }))).toBe('23514');
    await session(UB, { hours: 12 });
  });

  it('accepts an active organisation only for a member of it (23503), and a token only once (23505)', async () => {
    expect(await sqlState(session(UB, { org: A }))).toBe('23503');
    await session(UA, { org: A });
    const t = token();
    await session(UB, { token: t });
    expect(await sqlState(session(UB, { token: t }))).toBe('23505');
  });

  it('accepts only an Argon2id hash for the credential provider, once per person', async () => {
    expect(await sqlState(account(UB, 'plain-password'))).toBe('23514');
    expect(await sqlState(account(UB, '$2b$12$bcrypthashhashhashhashhash'))).toBe('23514');
    expect(await sqlState(account(UB, HASH, 'google'))).toBe('23514');
    await account(UB, HASH);
    expect(await sqlState(account(UB, HASH))).toBe('23505');
  });

  it('allows one 2FA enrolment per person (23505)', async () => {
    await twoFactor(UB);
    expect(await sqlState(twoFactor(UB))).toBe('23505');
  });
});
