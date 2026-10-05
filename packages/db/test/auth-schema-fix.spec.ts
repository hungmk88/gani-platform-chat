import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// PR6c-1 (N79): what Better Auth needs from the auth tables, found reading better-auth 1.7.7.
const org = uuidv7();
let user = '';
let admin: pg.Client;
let auth: pg.Client;

const session = (ip: string | null, agent: string | null) =>
  auth.query(
    `INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, now() + interval '1 hour', $4, $5)`,
    [uuidv7(), user, uuidv7(), ip, agent],
  );

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  auth = new pg.Client({ connectionString: url('auth') });
  await Promise.all([admin.connect(), auth.connect()]);
  user = await seedTenant(admin, org);
});

afterAll(async () => {
  await auth.end();
  for (const t of ['two_factors', 'sessions']) {
    await admin.query(`DELETE FROM ${t} WHERE user_id = $1`, [user]).catch(() => undefined);
  }
  await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('sessions.ip_address and sessions.user_agent', () => {
  it('accept NULL and the empty string, which is what Better Auth writes when it has no value', async () => {
    await session(null, null);
    await session('', '');
    const { rows } = await auth.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM sessions WHERE user_id = $1',
      [user],
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('refuse any real value (23514): personal data is never stored silently', async () => {
    expect(await sqlState(session('203.0.113.7', ''))).toBe('23514');
    expect(await sqlState(session('', 'Mozilla/5.0'))).toBe('23514');
  });

  it('cannot be filled in later: auth_role has no UPDATE on them (42501)', async () => {
    expect(await sqlState(auth.query("UPDATE sessions SET ip_address = ''"))).toBe('42501');
    expect(await sqlState(auth.query("UPDATE sessions SET user_agent = ''"))).toBe('42501');
  });
});

describe('two_factors.verified', () => {
  it('is false unless set, and auth_role can confirm an enrolment but not move it to another person', async () => {
    const id = uuidv7();
    await auth.query(
      "INSERT INTO two_factors (id, user_id, secret, backup_codes) VALUES ($1, $2, 's', 'c')",
      [id, user],
    );
    const before = await auth.query<{ verified: boolean }>(
      'SELECT verified FROM two_factors WHERE id = $1',
      [id],
    );
    expect(before.rows[0]?.verified).toBe(false);
    const confirm = await auth.query(
      'UPDATE two_factors SET verified = true, updated_at = now() WHERE id = $1',
      [id],
    );
    expect(confirm.rowCount).toBe(1);
    expect(await sqlState(auth.query('UPDATE two_factors SET user_id = user_id'))).toBe('42501');
  });
});

describe('the comments on verifications', () => {
  it('say that value is a payload for Better Auth and a token hash for the invitation flow', async () => {
    const { rows } = await admin.query<{ column: string; comment: string }>(
      `SELECT a.attname AS column, col_description(a.attrelid, a.attnum) AS comment FROM pg_attribute a
       WHERE a.attrelid = 'public.verifications'::regclass AND a.attname IN ('identifier', 'value') ORDER BY a.attname`,
    );
    expect(rows.map((r) => r.column)).toEqual(['identifier', 'value']);
    expect(rows[0]?.comment).toContain('storeIdentifier');
    expect(rows[1]?.comment).toContain('not a hash');
    expect(rows[1]?.comment).toContain('SHA-256');
  });
});
