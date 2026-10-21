import { createHash, randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { acceptInvite, createDbPool, InvalidInviteError, lookupInvite } from '../src/index.js';
import { sqlState, url } from './db.js';

// app.lookup_invite and app.accept_invite (spec RLS M01 §3.7, N147) on auth_role, the pool of the person following the link. Orgs A, B,
// C and E are live, D is deleted. An `active` person is a member of A; a `pending_password` person was invited by B before.
const [A, B, C, E, D] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const people: string[] = [];
let [ACTIVE, PENDING] = ['', ''];
let admin: pg.Client;
let auth: pg.Pool;
let app: pg.Pool;

const sha256 = (token: string) => createHash('sha256').update(token, 'utf8').digest();
const mail = () => `${uuidv7()}@example.test`;
async function person(status: 'active' | 'pending_password', since?: Date): Promise<string> {
  const id = uuidv7();
  people.push(id);
  // prettier-ignore
  await admin.query('INSERT INTO users (id, email, status, pending_password_since) VALUES ($1, $2, $3, $4)',
    [id, `${id}@example.test`, status, status === 'pending_password' ? (since ?? new Date()) : null]);
  return id;
}
const emailOf = (id: string) => `${id}@example.test`;
/** A pending invitation; returns its token (only the test knows it: the table holds its hash). */
async function invite(
  org: string,
  email: string,
  o: { role?: string; expiresInMs?: number; deleted?: boolean } = {},
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  // prettier-ignore
  await admin.query(
    `INSERT INTO org_members (id, org_id, invited_email, role, status, invite_token_hash, invite_expires_at, deleted_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, now() + make_interval(secs => $6::double precision / 1000), $7)`,
    [uuidv7(), org, email, o.role ?? 'sales', sha256(token), o.expiresInMs ?? 7 * 86_400_000, o.deleted ? new Date() : null]);
  return token;
}
const refused = (p: Promise<unknown>) =>
  p.then(
    () => 'accepted',
    (e: unknown) => (e instanceof InvalidInviteError ? 'invalid' : e),
  );
beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  auth = createDbPool(url('auth'), { max: 2 });
  app = createDbPool(url('app'), { max: 1 });
  for (const org of [A, B, C, E, D])
    await admin.query(
      'INSERT INTO organizations (id, slug, name, deleted_at) VALUES ($1, $2, $3, $4)',
      [org, `t-${org}`, 'T', org === D ? new Date() : null],
    );
  ACTIVE = await person('active');
  PENDING = await person('pending_password', new Date(Date.now() - 3_600_000));
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', 'active'), ($4, $5, $6, 'sales', 'active')`,
    [uuidv7(), A, ACTIVE, uuidv7(), B, PENDING],
  );
});

afterAll(async () => {
  const orgs = [A, B, C, E, D];
  await admin
    .query('DELETE FROM org_members WHERE org_id = ANY($1::uuid[])', [orgs])
    .catch(() => undefined);
  await admin
    .query('DELETE FROM users WHERE id = ANY($1::uuid[])', [people])
    .catch(() => undefined);
  await admin
    .query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [orgs])
    .catch(() => undefined);
  await Promise.all([admin.end(), auth.end(), app.end()]);
});

describe('app.lookup_invite', () => {
  it('shows a live invitation, and nothing for a wrong, expired, withdrawn or deleted-organisation one', async () => {
    const email = mail();
    const token = await invite(A, email, { role: 'manager' });
    expect(await lookupInvite(auth, token)).toEqual({
      memberId: expect.any(String) as string,
      orgId: A,
      invitedEmail: email,
      role: 'manager',
    });
    expect(await lookupInvite(auth, randomBytes(32).toString('base64url'))).toBeNull();
    expect(await lookupInvite(auth, await invite(A, mail(), { expiresInMs: -1000 }))).toBeNull();
    expect(await lookupInvite(auth, await invite(A, mail(), { deleted: true }))).toBeNull();
    expect(await lookupInvite(auth, await invite(D, mail()))).toBeNull();
  });
});

describe('app.accept_invite', () => {
  it('makes a new person pending_password, activates the membership and clears the token: it works once', async () => {
    const email = mail();
    const token = await invite(A, email, { role: 'support' });
    const newId = uuidv7();
    people.push(newId);
    expect(await acceptInvite(auth, token, newId)).toEqual({
      userId: newId,
      orgId: A,
      role: 'support',
    });
    const { rows } = await admin.query(
      'SELECT email, status, email_verified_at, pending_password_since IS NOT NULL AS since FROM users WHERE id = $1',
      [newId],
    );
    expect(rows).toEqual([
      { email, status: 'pending_password', email_verified_at: null, since: true },
    ]);
    const member = await admin.query(
      `SELECT status, invite_token_hash, invite_expires_at FROM org_members WHERE org_id = $1 AND user_id = $2`,
      [A, newId],
    );
    expect(member.rows).toEqual([
      { status: 'active', invite_token_hash: null, invite_expires_at: null },
    ]);
    expect(await refused(acceptInvite(auth, token, uuidv7()))).toBe('invalid');
    expect(await lookupInvite(auth, token)).toBeNull();
  });

  it('gives a signed-in person the membership when the invitation is for their email', async () => {
    const token = await invite(B, emailOf(ACTIVE));
    const unused = uuidv7();
    expect(await acceptInvite(auth, token, unused, ACTIVE)).toEqual({
      userId: ACTIVE,
      orgId: B,
      role: 'sales',
    });
    expect((await admin.query('SELECT 1 FROM users WHERE id = $1', [unused])).rowCount).toBe(0);
  });

  it('lets a person still setting a password join a second organisation, and starts their 24 hours again', async () => {
    const before = (
      await admin.query('SELECT pending_password_since AS t FROM users WHERE id = $1', [PENDING])
    ).rows[0] as { t: Date };
    const token = await invite(A, emailOf(PENDING));
    expect(await acceptInvite(auth, token, uuidv7())).toMatchObject({ userId: PENDING, orgId: A });
    const after = (
      await admin.query('SELECT pending_password_since AS t FROM users WHERE id = $1', [PENDING])
    ).rows[0] as { t: Date };
    expect(after.t.getTime()).toBeGreaterThan(before.t.getTime());
  });

  it('refuses every other case with one and the same error, and changes nothing', async () => {
    const cases: [string, () => Promise<unknown>][] = [
      [
        'a wrong token',
        async () => acceptInvite(auth, randomBytes(32).toString('base64url'), uuidv7()),
      ],
      [
        'an expired one',
        async () => acceptInvite(auth, await invite(A, mail(), { expiresInMs: -1 }), uuidv7()),
      ],
      [
        'a withdrawn one',
        async () => acceptInvite(auth, await invite(A, mail(), { deleted: true }), uuidv7()),
      ],
      [
        'one of a deleted organisation',
        async () => acceptInvite(auth, await invite(D, mail()), uuidv7()),
      ],
      [
        'another email than the signed-in person',
        async () => acceptInvite(auth, await invite(B, mail()), uuidv7(), ACTIVE),
      ],
      [
        'an active account not signed in',
        async () => acceptInvite(auth, await invite(C, emailOf(ACTIVE)), uuidv7()),
      ],
      [
        'a person already a member',
        async () =>
          acceptInvite(
            auth,
            await invite(A, emailOf(ACTIVE), { role: 'viewer' }),
            uuidv7(),
            ACTIVE,
          ),
      ],
    ];
    const errors: unknown[] = [];
    for (const [name, run] of cases) {
      const error = await run().then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, name).toBeInstanceOf(InvalidInviteError);
      errors.push((error as Error).message);
    }
    expect(new Set(errors).size).toBe(1);
  });

  it('raises the same SQLSTATE and message for every reason, so no caller can tell them apart', async () => {
    const raw = async (token: string) => {
      const client = await auth.connect();
      try {
        await client.query('SELECT * FROM app.accept_invite($1, $2)', [token, uuidv7()]);
        return null;
      } catch (error) {
        const e = error as { code?: string; message?: string };
        return `${e.code ?? ''} ${e.message ?? ''}`;
      } finally {
        client.release();
      }
    };
    const answers = [
      await raw(randomBytes(32).toString('base64url')),
      await raw(await invite(A, mail(), { expiresInMs: -1 })),
      await raw(await invite(E, emailOf(ACTIVE))),
    ];
    expect(answers).toEqual(Array(3).fill('IV001 invite_invalid'));
  });

  it('is for auth_role only, and auth_role cannot write users itself', async () => {
    expect(await sqlState(app.query('SELECT * FROM app.lookup_invite($1)', ['x']))).toBe('42501');
    expect(
      await sqlState(app.query('SELECT * FROM app.accept_invite($1, $2)', ['x', uuidv7()])),
    ).toBe('42501');
    const id = uuidv7();
    expect(
      await sqlState(
        auth.query(
          `INSERT INTO users (id, email, status, pending_password_since) VALUES ($1, $2, 'pending_password', now())`,
          [id, emailOf(id)],
        ),
      ),
    ).toBe('42501');
  });
});
