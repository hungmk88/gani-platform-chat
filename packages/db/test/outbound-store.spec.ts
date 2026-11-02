import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimOutboundDelivery,
  completeOutboundDelivery,
  createDbPool,
  failOutboundDelivery,
  loadWindowFacts,
  outboundPendingOrgs,
  retryOutboundDelivery,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The store of the outbound worker on PostgreSQL as app_role (O2, N185): the claim of the oldest pending delivery of a conversation
// under a lease, the results written under the same claim, and the window facts counted before the message being sent.
const [A, B] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
const place = new Map<string, { workspace: string; channel: string }>();
let admin: pg.Client;
let pool: pg.Pool;
const LEASE = 60;

const as = <T>(org: string, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: org, workspaceIds: [place.get(org)!.workspace] }, fn);
const claim = (org = A) => as(org, (tx) => claimOutboundDelivery(tx, LEASE));

/** A conversation of the channel with a person of its own (one open conversation per person and channel). */
async function conversation(org = A): Promise<string> {
  const id = uuidv7();
  const { workspace, channel } = place.get(org)!;
  await admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state, channel_account_id, external_user_id, last_customer_message_at)
     VALUES ($1, $2, $3, 'BOT_ACTIVE', $4, $5, now())`,
    [id, org, workspace, channel, `zu-${id}`],
  );
  return id;
}
/** A message of the account at `seq` and its pending delivery, created `ago` before now. */
async function send(conv: string, seq: number, ago = '0', org = A) {
  const { workspace, channel } = place.get(org)!;
  const [message, delivery] = [uuidv7(), uuidv7()];
  await admin.query(
    `INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, body)
     VALUES ($1, $2, $3, $4, $5, 'bot', 'text', 'xin chào')`,
    [message, org, workspace, conv, seq],
  );
  await admin.query(
    `INSERT INTO message_deliveries (id, org_id, workspace_id, conversation_id, message_id, channel_account_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() - $7::interval)`,
    [delivery, org, workspace, conv, message, channel, ago],
  );
  return delivery;
}
const row = async (id: string) =>
  (
    await admin.query<{
      status: string;
      attempts: number;
      claimed: boolean;
      last_error: string | null;
      due: boolean;
    }>(
      `SELECT status, attempts, claimed_at IS NOT NULL AS claimed, last_error, next_attempt_at <= now() AS due
       FROM message_deliveries WHERE id = $1`,
      [id],
    )
  ).rows[0]!;
const clear = () =>
  admin.query('DELETE FROM message_deliveries WHERE org_id = ANY($1::uuid[])', [[A, B]]);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 3 });
  for (const org of [A, B]) {
    users.set(org, await seedTenant(admin, org));
    const { rows } = await admin.query<{ workspace: string; channel: string }>(
      'SELECT workspace_id AS workspace, id AS channel FROM channel_accounts WHERE org_id = $1',
      [org],
    );
    place.set(org, rows[0]!);
  }
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('claimOutboundDelivery', () => {
  it('claims the oldest pending delivery of a conversation with what the channel needs, and none behind it while it is held', async () => {
    await clear();
    const conv = await conversation();
    // Written in the reverse order of time: the message's sequence number decides, not created_at nor the id.
    const second = await send(conv, 3, '2 minutes');
    const first = await send(conv, 2, '1 minute');
    const held = await claim();
    expect(held).toMatchObject({
      id: first,
      conversationId: conv,
      attempts: 1,
      message: { kind: 'text', body: 'xin chào', sequenceNumber: 2 },
      externalUserId: `zu-${conv}`,
      account: { type: 'zalo_oa', keyVersion: 1 },
    });
    expect(held!.claimedAt).toBeInstanceOf(Date);
    // The second waits for the first: in flight, then waiting for its next attempt.
    expect(await claim()).toBeNull();
    await as(A, (tx) =>
      retryOutboundDelivery(tx, held!, { errorCode: 'E_NET', delaySeconds: 300 }),
    );
    expect(await claim()).toBeNull();
    expect(await row(first)).toMatchObject({ claimed: false, due: false, last_error: 'E_NET' });
    // Another conversation is not held up.
    const other = await send(await conversation(), 2);
    expect((await claim())?.id).toBe(other);
    expect((await row(second)).claimed).toBe(false);
  });

  it('hands two workers that claim at once different deliveries without waiting (SKIP LOCKED)', async () => {
    await clear();
    const [x, y] = [await send(await conversation(), 2), await send(await conversation(), 2)];
    // The second claim must answer while the first transaction still holds its row, not after it commits.
    const [mine, other] = await as(A, async (tx) => {
      const held = await claimOutboundDelivery(tx, LEASE);
      const late = new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 1500));
      return [held, await Promise.race([claim(), late])] as const;
    });
    expect(other).not.toBe('blocked');
    expect([mine?.id, other === 'blocked' ? null : other?.id].sort()).toEqual([x, y].sort());
  });

  it('takes back a claim older than the lease, and counts the attempt', async () => {
    await clear();
    const id = await send(await conversation(), 2);
    await claim();
    expect(await claim()).toBeNull();
    await admin.query(
      `UPDATE message_deliveries SET claimed_at = now() - interval '5 minutes' WHERE id = $1`,
      [id],
    );
    expect(await claim()).toMatchObject({ id, attempts: 2 });
  });

  it('sees only the deliveries of the tenant workspace and organisation', async () => {
    await clear();
    await send(await conversation(B), 2, '0', B);
    expect(await claim(A)).toBeNull();
    await expect(as(A, (tx) => claimOutboundDelivery(tx, 0))).rejects.toThrow(RangeError);
  });
});

describe('the results', () => {
  it('writes sent, a retry or failed under the same claim only, and refuses a code that is not one', async () => {
    await clear();
    const conv = await conversation();
    const [a, b] = [await send(conv, 2, '1 minute'), await send(await conversation(), 2)];
    const heldA = (await claim())!;
    const stale = { id: a, claimedAt: new Date(heldA.claimedAt.getTime() - 1000) };
    expect(await as(A, (tx) => completeOutboundDelivery(tx, stale, 'p-1'))).toBe(false);
    expect(await as(A, (tx) => completeOutboundDelivery(tx, heldA, 'p-1'))).toBe(true);
    expect(await row(a)).toMatchObject({ status: 'sent', claimed: false, last_error: null });
    expect(await as(A, (tx) => completeOutboundDelivery(tx, heldA, 'p-2'))).toBe(false);
    const heldB = (await claim())!;
    expect(heldB.id).toBe(b);
    await expect(as(A, (tx) => failOutboundDelivery(tx, heldB, 'not a code'))).rejects.toThrow(
      TypeError,
    );
    await expect(as(A, (tx) => completeOutboundDelivery(tx, heldB, ' '))).rejects.toThrow(
      TypeError,
    );
    await expect(
      as(A, (tx) => retryOutboundDelivery(tx, heldB, { errorCode: 'E_X', delaySeconds: -1 })),
    ).rejects.toThrow(RangeError);
    expect(await as(A, (tx) => failOutboundDelivery(tx, heldB, 'CHANNEL_WINDOW_CLOSED'))).toBe(
      true,
    );
    expect(await row(b)).toMatchObject({
      status: 'failed',
      claimed: false,
      last_error: 'CHANNEL_WINDOW_CLOSED',
    });
    expect(await claim()).toBeNull();
  });

  it('names the organisations with work through app.outbound_pending_orgs', async () => {
    await clear();
    await send(await conversation(B), 2, '0', B);
    expect(await outboundPendingOrgs(pool, 1000, LEASE)).toContain(B);
    expect(await outboundPendingOrgs(pool, 1000, LEASE)).not.toContain(A);
  });
});

describe('loadWindowFacts before a message', () => {
  it('counts only the account messages written before the one being sent', async () => {
    await clear();
    const conv = await conversation();
    await admin.query(
      `INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, body)
       VALUES ($1, $2, $3, $4, 1, 'customer', 'text', 'alo')`,
      [uuidv7(), A, place.get(A)!.workspace, conv],
    );
    for (const seq of [2, 3, 4]) await send(conv, seq);
    const facts = (before?: number) =>
      as(A, (tx) =>
        loadWindowFacts(tx, conv, before === undefined ? {} : { beforeSequence: before }),
      );
    expect((await facts())?.officialMessagesSinceCustomer).toBe(3);
    expect((await facts(3))?.officialMessagesSinceCustomer).toBe(1);
    expect((await facts(2))?.officialMessagesSinceCustomer).toBe(0);
    await expect(facts(0)).rejects.toThrow(RangeError);
  });
});
