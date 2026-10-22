import { createHash, randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  acceptInviteWithPassword,
  createDbPool,
  InvalidInviteError,
  lookupInvite,
} from '../src/index.js';
import { url } from './db.js';

// The one step of a person who is not signed in (N151): accept + password + active, in one transaction of auth_role, or nothing.
const ORG = uuidv7();
const people: string[] = [];
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA';
let admin: pg.Client;
let auth: pg.Pool;

const sha256 = (token: string) => createHash('sha256').update(token, 'utf8').digest();
async function invite(email: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  // prettier-ignore
  await admin.query(
    `INSERT INTO org_members (id, org_id, invited_email, role, status, invite_token_hash, invite_expires_at)
     VALUES ($1, $2, $3, 'owner', 'pending', $4, now() + interval '7 days')`, [uuidv7(), ORG, email, sha256(token)]);
  return token;
}
const userOf = async (email: string) =>
  (
    await admin.query(
      `SELECT u.id, u.status, u.display_name, u.email_verified_at IS NOT NULL AS verified, u.pending_password_since, a.password
       FROM users u LEFT JOIN accounts a ON a.user_id = u.id WHERE u.email = $1`,
      [email],
    )
  ).rows as Record<string, unknown>[];
const password = (displayName?: string) => ({
  passwordHash: HASH,
  accountId: uuidv7(),
  ...(displayName === undefined ? {} : { displayName }),
});
const newId = () => {
  const id = uuidv7();
  people.push(id);
  return id;
};

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  auth = createDbPool(url('auth'), { max: 2 });
  await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
    ORG,
    `t-${ORG}`,
    'T',
  ]);
});

afterAll(async () => {
  await admin.query('DELETE FROM org_members WHERE org_id = $1', [ORG]).catch(() => undefined);
  await admin
    .query('DELETE FROM accounts WHERE user_id = ANY($1::uuid[])', [people])
    .catch(() => undefined);
  await admin
    .query('DELETE FROM users WHERE id = ANY($1::uuid[])', [people])
    .catch(() => undefined);
  await admin.query('DELETE FROM organizations WHERE id = $1', [ORG]).catch(() => undefined);
  await Promise.all([admin.end(), auth.end()]);
});

describe('acceptInviteWithPassword', () => {
  it('makes the invited person active with their password and name, and the membership active, at once', async () => {
    const email = `${uuidv7()}@example.test`;
    const token = await invite(email);
    const id = newId();
    expect(await acceptInviteWithPassword(auth, token, id, password('  Lan  '))).toEqual({
      userId: id,
      orgId: ORG,
      role: 'owner',
    });
    expect(await userOf(email)).toEqual([
      {
        id,
        status: 'active',
        display_name: 'Lan',
        verified: true,
        pending_password_since: null,
        password: HASH,
      },
    ]);
    const member = await admin.query(
      'SELECT status, invite_token_hash FROM org_members WHERE user_id = $1',
      [id],
    );
    expect(member.rows).toEqual([{ status: 'active', invite_token_hash: null }]);
    expect(await lookupInvite(auth, token)).toBeNull();
  });

  it('keeps no name when none is given', async () => {
    const email = `${uuidv7()}@example.test`;
    await acceptInviteWithPassword(auth, await invite(email), newId(), password(' '));
    expect((await userOf(email))[0]).toMatchObject({ status: 'active', display_name: null });
  });

  it('leaves nothing behind when a later step fails: the invitation is still there and nobody was made', async () => {
    const email = `${uuidv7()}@example.test`;
    const token = await invite(email);
    const broken = { ...password(), passwordHash: 'plain text' };
    await expect(acceptInviteWithPassword(auth, token, newId(), broken)).rejects.toMatchObject({
      code: '23514',
    });
    expect(await userOf(email)).toEqual([]);
    expect(await lookupInvite(auth, token)).toMatchObject({ orgId: ORG, invitedEmail: email });
  });

  it('refuses an account that already has a password: that person signs in first, and nothing changes', async () => {
    const existing = newId();
    const email = `${existing}@example.test`;
    // prettier-ignore
    await admin.query(`INSERT INTO users (id, email, status, email_verified_at) VALUES ($1, $2, 'active', now())`, [existing, email]);
    const token = await invite(email);
    await expect(acceptInviteWithPassword(auth, token, newId(), password())).rejects.toBeInstanceOf(
      InvalidInviteError,
    );
    expect(await userOf(email)).toEqual([
      expect.objectContaining({ id: existing, password: null }),
    ]);
    expect(await lookupInvite(auth, token)).not.toBeNull();
  });
});
