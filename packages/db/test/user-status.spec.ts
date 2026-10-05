import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';

// PR6b (spec RLS M01 §3.2, N77, N78): users.status only goes pending_password -> active, and then the trigger sets
// email_verified_at = now() and clears pending_password_since. Everything else about those two columns is refused, for every role.
const created: string[] = [];
let admin: pg.Client;
let auth: pg.Client;

async function newUser(status: 'pending_password' | 'active'): Promise<string> {
  const id = uuidv7();
  created.push(id);
  await admin.query(
    `INSERT INTO users (id, email, status, pending_password_since, email_verified_at)
     VALUES ($1, $2, $3, CASE WHEN $3 = 'pending_password' THEN now() END, CASE WHEN $3 = 'active' THEN now() END)`,
    [id, `${id}@example.test`, status],
  );
  return id;
}
const row = async (id: string) =>
  (
    await admin.query<{
      status: string;
      verified: boolean;
      since: Date | null;
      age: number | null;
    }>(
      `SELECT status, email_verified_at IS NOT NULL AS verified, pending_password_since AS since,
              extract(epoch FROM now() - email_verified_at)::float AS age FROM users WHERE id = $1`,
      [id],
    )
  ).rows[0];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  auth = new pg.Client({ connectionString: url('auth') });
  await Promise.all([admin.connect(), auth.connect()]);
});

afterAll(async () => {
  await auth.end();
  await admin
    .query('DELETE FROM users WHERE id = ANY($1::uuid[])', [created])
    .catch(() => undefined);
  await admin.end();
});

describe('the one allowed change: pending_password -> active', () => {
  it('sets email_verified_at to the server time, ignoring the value sent, and clears pending_password_since', async () => {
    const id = await newUser('pending_password');
    expect((await row(id))?.verified).toBe(false);
    const res = await auth.query(
      "UPDATE users SET status = 'active', email_verified_at = '2000-01-01' WHERE id = $1",
      [id],
    );
    expect(res.rowCount).toBe(1);
    const after = await row(id);
    expect(after?.status).toBe('active');
    expect(after?.since).toBeNull();
    expect(after?.verified).toBe(true);
    expect(after?.age).toBeLessThan(60);
  });

  it('works without naming email_verified_at too', async () => {
    const id = await newUser('pending_password');
    await auth.query("UPDATE users SET status = 'active' WHERE id = $1", [id]);
    expect(await row(id)).toMatchObject({ status: 'active', verified: true, since: null });
  });
});

describe('everything else is refused (23514, with a message that says why)', () => {
  it('refuses active -> pending_password, also when it is the same statement as the allowed change', async () => {
    const id = await newUser('pending_password');
    await auth.query("UPDATE users SET status = 'active' WHERE id = $1", [id]);
    const back = auth.query("UPDATE users SET status = 'pending_password' WHERE id = $1", [id]);
    await expect(back).rejects.toThrow(/may only change from pending_password to active/);
    expect(
      await sqlState(
        auth.query("UPDATE users SET status = 'pending_password' WHERE id = $1", [id]),
      ),
    ).toBe('23514');
    expect((await row(id))?.status).toBe('active');
  });

  it('refuses to set or clear email_verified_at without the change of status', async () => {
    const pending = await newUser('pending_password');
    const active = await newUser('active');
    const set = auth.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [pending]);
    await expect(set).rejects.toThrow(/only be set together with the change/);
    const clear = auth.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [active]);
    await expect(clear).rejects.toThrow(/only be set together with the change/);
    const touch = auth.query("UPDATE users SET email_verified_at = '2000-01-01' WHERE id = $1", [
      active,
    ]);
    expect(await sqlState(touch)).toBe('23514');
    expect((await row(pending))?.verified).toBe(false);
    // The refused statements changed nothing: the verified user is still verified.
    expect((await row(active))?.verified).toBe(true);
  });

  it('applies to migration_role as well', async () => {
    const id = await newUser('active');
    const back = admin.query("UPDATE users SET status = 'pending_password' WHERE id = $1", [id]);
    await expect(back).rejects.toThrow(/may only change from pending_password to active/);
  });
});

describe('what the trigger leaves alone', () => {
  it('lets the same status through, and every other column', async () => {
    const id = await newUser('active');
    const same = await auth.query("UPDATE users SET status = 'active' WHERE id = $1", [id]);
    expect(same.rowCount).toBe(1);
    const other = await auth.query(
      'UPDATE users SET failed_login_count = 2, display_name = $2 WHERE id = $1',
      [id, 'N'],
    );
    expect(other.rowCount).toBe(1);
  });

  it('lets migration_role renew pending_password_since, as app.accept_invite will (PR7)', async () => {
    const id = await newUser('pending_password');
    const res = await admin.query(
      "UPDATE users SET pending_password_since = now() + interval '1 minute' WHERE id = $1",
      [id],
    );
    expect(res.rowCount).toBe(1);
  });
});

describe('the grant and the trigger itself', () => {
  it('still refuses auth_role every other column of users (42501)', async () => {
    for (const column of [
      'email',
      'is_platform_operator',
      'pending_password_since',
      'deleted_at',
    ]) {
      expect(await sqlState(auth.query(`UPDATE users SET ${column} = ${column}`)), column).toBe(
        '42501',
      );
    }
  });

  it('is a BEFORE UPDATE OF status, email_verified_at trigger, enabled, named users_status_transition_check', async () => {
    const { rows } = await admin.query<{ tgname: string; enabled: string; def: string }>(
      `SELECT tgname, tgenabled AS enabled, pg_get_triggerdef(oid) AS def FROM pg_trigger
       WHERE tgrelid = 'public.users'::regclass AND NOT tgisinternal AND tgname = 'users_status_transition_check'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe('O');
    expect(rows[0]?.def).toContain('BEFORE UPDATE OF status, email_verified_at ON public.users');
  });
});
