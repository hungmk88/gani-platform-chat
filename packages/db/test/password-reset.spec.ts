import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, issuePasswordReset, resetPassword } from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// "Quên mật khẩu" (N162) as auth_role on PostgreSQL: a link is good once for 30 minutes, only its hash is kept, a new one ends the old,
// and a reset changes the password, ends every session, lifts the lock and is audited in each organisation of the person, or nothing.
const A = uuidv7();
let seedUser = '';
const people: string[] = [];
let admin: pg.Client;
let auth: pg.Pool;
const token = () => randomBytes(32).toString('base64url');

async function person(
  o: { status?: string; deleted?: boolean; password?: boolean; member?: boolean } = {},
) {
  const id = uuidv7();
  people.push(id);
  const pending = (o.status ?? 'active') === 'pending_password';
  await admin.query(
    `INSERT INTO users (id, email, status, pending_password_since, deleted_at, failed_login_count, locked_until)
     VALUES ($1, $2, $3, $4, $5, 4, now() + interval '20 minutes')`,
    [
      id,
      `${id}@example.test`,
      o.status ?? 'active',
      pending ? new Date() : null,
      o.deleted ? new Date() : null,
    ],
  );
  if (o.password ?? true)
    await admin.query(
      `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', '$argon2id$old')`,
      [uuidv7(), id, id],
    );
  if (o.member ?? true)
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', 'active')`,
      [uuidv7(), A, id],
    );
  for (let i = 0; i < 2; i += 1)
    await admin.query(
      `INSERT INTO sessions (id, user_id, token, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [uuidv7(), id, randomBytes(16).toString('hex')],
    );
  return id;
}
const issue = (email: string, t: string) =>
  issuePasswordReset(auth, { email, token: t, id: uuidv7() });
const reset = (t: string) =>
  resetPassword(auth, { token: t, passwordHash: '$argon2id$new', newId: uuidv7 });
const stateOf = async (id: string) =>
  (
    await admin.query(
      `SELECT a.password, u.failed_login_count, u.locked_until,
              (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS live,
              (SELECT count(*)::int FROM audit_logs l WHERE l.org_id = $2 AND l.actor_user_id = u.id AND l.action = 'user.password_reset') AS audited
       FROM users u LEFT JOIN accounts a ON a.user_id = u.id WHERE u.id = $1`,
      [id, A],
    )
  ).rows[0] as {
    password: string;
    failed_login_count: number;
    locked_until: Date | null;
    live: number;
    audited: number;
  };

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  auth = createDbPool(url('auth'), { max: 2 });
  seedUser = await seedTenant(admin, A);
});

afterAll(async () => {
  await auth.end();
  for (const t of ['sessions', 'accounts'])
    await admin.query(`DELETE FROM ${t} WHERE user_id = ANY($1::uuid[])`, [people]);
  await admin.query('DELETE FROM verifications WHERE value = ANY($1::text[])', [people]);
  await admin.query('DELETE FROM org_members WHERE user_id = ANY($1::uuid[])', [people]);
  await cleanupTenant(admin, A, seedUser);
  await admin
    .query('DELETE FROM users WHERE id = ANY($1::uuid[])', [people])
    .catch(() => undefined);
  await admin.end();
});

describe('password reset', () => {
  it('keeps only the hash of a link for 30 minutes, ends the link before it, and resets once', async () => {
    const p = await person();
    const [first, second] = [token(), token()];
    expect(await issue(` ${p}@example.TEST `, first)).toEqual({ userId: p });
    expect(await issue(`${p}@example.test`, second)).toEqual({ userId: p });
    const rows = await admin.query<{ identifier: string; minutes: number; used: boolean }>(
      `SELECT identifier, round(extract(epoch FROM expires_at - created_at) / 60)::int AS minutes, used_at IS NOT NULL AS used
       FROM verifications WHERE value = $1 ORDER BY created_at, id`,
      [p],
    );
    expect(rows.rows.map((r) => [r.minutes, r.used])).toEqual([
      [30, true],
      [30, false],
    ]);
    for (const r of rows.rows) {
      expect(r.identifier).toMatch(/^password-reset:[0-9a-f]{64}$/);
      expect(r.identifier).not.toContain(first);
      expect(r.identifier).not.toContain(second);
    }
    expect(await reset(first)).toBeNull();
    expect((await stateOf(p)).password).toBe('$argon2id$old');
    expect(await reset(second)).toEqual({ userId: p });
    expect(await stateOf(p)).toEqual({
      password: '$argon2id$new',
      failed_login_count: 0,
      locked_until: null,
      live: 0,
      audited: 1,
    });
    expect(await reset(second)).toBeNull();
  });

  it('issues nothing for an unknown email, a pending, deleted or passwordless person', async () => {
    const people = [
      await person({ status: 'pending_password', password: false }),
      await person({ deleted: true }),
      await person({ password: false }),
    ];
    for (const p of [...people, uuidv7()])
      expect(await issue(`${p}@example.test`, token()), p).toBeNull();
    const made = await admin.query('SELECT 1 FROM verifications WHERE value = ANY($1::text[])', [
      people,
    ]);
    expect(made.rows).toEqual([]);
  });

  it('changes nothing for an expired link, a person deleted since, or a token that was never issued', async () => {
    const [late, gone] = [await person(), await person({ member: false })];
    const [t1, t2] = [token(), token()];
    await issue(`${late}@example.test`, t1);
    await issue(`${gone}@example.test`, t2);
    await admin.query(
      `UPDATE verifications SET created_at = now() - interval '31 minutes', expires_at = now() - interval '1 minute' WHERE value = $1`,
      [late],
    );
    await admin.query('UPDATE users SET deleted_at = now() WHERE id = $1', [gone]);
    for (const t of [t1, t2, token()]) expect(await reset(t)).toBeNull();
    // The deleted person's sessions were ended by users_deleted_revoke_sessions, not by a reset.
    expect(await stateOf(late)).toMatchObject({
      password: '$argon2id$old',
      live: 2,
      failed_login_count: 4,
    });
    expect(await stateOf(gone)).toMatchObject({
      password: '$argon2id$old',
      failed_login_count: 4,
      audited: 0,
    });
  });
});
