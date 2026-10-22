import { createHash } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  createMemberInvite,
  lockPendingInvite,
  lookupInvite,
  newInviteToken,
  renewMemberInvite,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Invitations made by a member (DB-02b-c): created and renewed by app_role in the tenant transaction, accepted through
// app.lookup_invite / app.accept_invite (invites.spec). seedTenant makes an active owner in each organisation.
const [A, B] = [uuidv7(), uuidv7()];
let [ownerA, ownerB] = ['', ''];
let admin: pg.Client;
let app: pg.Pool;
let auth: pg.Pool;

const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(app, { orgId: A, workspaceIds: [] }, fn);
const invite = (email: string, token = newInviteToken()) =>
  inA((tx) =>
    createMemberInvite(tx, {
      id: uuidv7(),
      email,
      role: 'sales',
      invitedBy: ownerA,
      tokenHash: token.hash,
    }),
  ).then((created) => ({ created, token: token.token }));
const rowOf = async (id: string) =>
  (await admin.query('SELECT * FROM org_members WHERE id = $1', [id])).rows[0] as Record<
    string,
    unknown
  >;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  app = createDbPool(url('app'), { max: 2 });
  auth = createDbPool(url('auth'), { max: 2 });
  ownerA = await seedTenant(admin, A);
  ownerB = await seedTenant(admin, B);
});

afterAll(async () => {
  await cleanupTenant(admin, A, ownerA);
  await cleanupTenant(admin, B, ownerB);
  await Promise.all([app.end(), auth.end()]);
  await admin.end();
});

describe('createMemberInvite', () => {
  it('keeps the SHA-256 of the token, for seven days, and the invitation can be looked up with the token', async () => {
    const { created, token } = await invite(`${uuidv7()}@example.test`);
    expect(created).toMatchObject({ role: 'sales' });
    const row = await rowOf(created!.id);
    expect(row).toMatchObject({ org_id: A, status: 'pending', user_id: null, invited_by: ownerA });
    expect(row['invite_token_hash']).toEqual(createHash('sha256').update(token).digest());
    const days = ((row['invite_expires_at'] as Date).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect(await lookupInvite(auth, token)).toMatchObject({ invitedEmail: created!.invitedEmail });
  });

  it('answers null for an email this organisation has invited already, and leaves the first invitation as it was', async () => {
    const email = `${uuidv7()}@example.test`;
    const first = await invite(email);
    const second = await invite(email);
    expect(second.created).toBeNull();
    const { rows } = await admin.query('SELECT id FROM org_members WHERE invited_email = $1', [
      email,
    ]);
    expect(rows).toEqual([{ id: first.created!.id }]);
    expect(await lookupInvite(auth, first.token)).not.toBeNull();
  });
});

describe('lockPendingInvite and renewMemberInvite', () => {
  it('gives a new token and seven more days; the token sent before stops working', async () => {
    const { created, token } = await invite(`${uuidv7()}@example.test`);
    await admin.query(
      "UPDATE org_members SET invite_expires_at = now() + interval '1 hour' WHERE id = $1",
      [created!.id],
    );
    const fresh = newInviteToken();
    const renewed = await inA(async (tx) => {
      expect(await lockPendingInvite(tx, created!.id)).toMatchObject({ id: created!.id });
      return renewMemberInvite(tx, created!.id, fresh.hash);
    });
    expect(renewed!.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.99 * 86_400_000);
    expect(await lookupInvite(auth, token)).toBeNull();
    expect(await lookupInvite(auth, fresh.token)).toMatchObject({ role: 'sales' });
  });

  it('finds no active member, and no invitation of another organisation', async () => {
    const active = (
      await admin.query('SELECT id FROM org_members WHERE org_id = $1 AND user_id = $2', [
        A,
        ownerA,
      ])
    ).rows[0] as { id: string };
    const ofB = { id: uuidv7() };
    // prettier-ignore
    await admin.query(`INSERT INTO org_members (id, org_id, invited_email, role, status, invite_token_hash, invite_expires_at)
                       VALUES ($1, $2, $3, 'sales', 'pending', $4, now() + interval '7 days')`,
      [ofB.id, B, `${uuidv7()}@example.test`, newInviteToken().hash]);
    const answers = await inA(async (tx) => [
      await lockPendingInvite(tx, active.id),
      await renewMemberInvite(tx, active.id, newInviteToken().hash),
      await lockPendingInvite(tx, ofB.id),
      await renewMemberInvite(tx, ofB.id, newInviteToken().hash),
    ]);
    expect(answers).toEqual([null, null, null, null]);
    expect(await rowOf(active.id)).toMatchObject({ status: 'active', invite_token_hash: null });
  });
});
