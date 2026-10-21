import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, loadWindowFacts, readChannelPolicy, withTenant } from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// What ChannelPolicyService reads before a send (channel-policy-spec §2, §4): the policy in force at a time (C-N6), and the facts of a
// conversation under RLS. Policy rows of this test are `webchat`/`broadcast` around the year 2990, so no real row and no row of
// channel-policies.spec (zalo_oa, 2999) is ever in the way; afterAll removes them.
const [A, B] = [uuidv7(), uuidv7()];
const [P1, P2] = [uuidv7(), uuidv7()];
const [WITH_CHANNEL, NO_CHANNEL, NEVER_WROTE] = [uuidv7(), uuidv7(), uuidv7()];
const users = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;
let [WA, CA, WB] = ['', '', ''];

const policy = (id: string, from: string, window: number) =>
  admin.query(
    `INSERT INTO channel_policies (id, channel_type, message_class, effective_from, free_window_seconds, free_message_quota, outside_window_allowed, note)
     VALUES ($1, 'webchat', 'broadcast', $2, $3, 3, false, 'test')`,
    [id, from, window],
  );
const conversation = (id: string, channel: string | null, last: Date | null) =>
  admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state, channel_account_id, external_user_id, last_customer_message_at)
     VALUES ($1, $2, $3, 'BOT_ACTIVE', $4, $5, $6)`,
    [id, A, WA, channel, channel ? `zu-${id}` : null, last],
  );
const messages = (id: string, senders: string[]) =>
  admin.query(
    `INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, body)
     SELECT gen_random_uuid(), $1, $2, $3, n, s, 'text', 'm' FROM unnest($4::text[]) WITH ORDINALITY AS t(s, n)`,
    [A, WA, id, senders],
  );
const facts = (org: string, id: string) =>
  withTenant(pool, { orgId: org, workspaceIds: [org === A ? WA : WB] }, (tx) =>
    loadWindowFacts(tx, id),
  );
const read = (channel: string, klass: string, at: string) =>
  withTenant(pool, { orgId: A, workspaceIds: [WA] }, (tx) =>
    readChannelPolicy(tx, channel, klass, new Date(at)),
  );

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  const one = async (sql: string, org: string) =>
    ((await admin.query<{ id: string }>(sql, [org])).rows[0] as { id: string }).id;
  WA = await one('SELECT id FROM workspaces WHERE org_id = $1', A);
  WB = await one('SELECT id FROM workspaces WHERE org_id = $1', B);
  CA = await one('SELECT id FROM channel_accounts WHERE org_id = $1', A);
  await policy(P1, '2990-01-01T00:00:00Z', 3600);
  await policy(P2, '2990-07-01T00:00:00Z', 7200);
  await conversation(WITH_CHANNEL, CA, new Date('2026-10-20T08:00:00Z'));
  await messages(WITH_CHANNEL, ['customer', 'agent', 'bot', 'customer', 'agent', 'system']);
  await conversation(NO_CHANNEL, null, null);
  await conversation(NEVER_WROTE, CA, null);
  await messages(NEVER_WROTE, ['agent', 'agent']);
});

afterAll(async () => {
  await admin
    .query('DELETE FROM channel_policies WHERE id = ANY($1::uuid[])', [[P1, P2]])
    .catch(() => undefined);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
  await pool.end();
});

describe('readChannelPolicy', () => {
  it('C-N6: takes the row with the latest effective_from at or before the time asked', async () => {
    expect(await read('webchat', 'broadcast', '2989-12-31T23:59:59Z')).toBeNull();
    expect((await read('webchat', 'broadcast', '2990-01-01T00:00:00Z'))?.id).toBe(P1);
    expect((await read('webchat', 'broadcast', '2990-06-30T23:59:59Z'))?.freeWindowSeconds).toBe(
      3600,
    );
    expect((await read('webchat', 'broadcast', '2990-07-01T00:00:00Z'))?.id).toBe(P2);
  });

  it('reads the seeded policy of Zalo OA today, and nothing for a channel with no row', async () => {
    expect(await read('zalo_oa', 'advisory', '2026-10-21T00:00:00Z')).toEqual({
      id: '01a116b2-f52b-7632-9d7e-7e4c11f4d2b8',
      freeWindowSeconds: 172800,
      freeMessageQuota: 8,
      outsideWindowAllowed: true,
      note: 'tạm, chờ xác nhận',
    });
    expect(await read('facebook', 'advisory', '2026-10-21T00:00:00Z')).toBeNull();
  });
});

describe('loadWindowFacts', () => {
  it('counts the messages of the account after the last message of the person, and names the channel', async () => {
    expect(await facts(A, WITH_CHANNEL)).toEqual({
      channelType: 'zalo_oa',
      lastCustomerMessageAt: new Date('2026-10-20T08:00:00Z'),
      officialMessagesSinceCustomer: 2,
    });
  });

  it('has no channel type for a conversation without a channel, and counts every message when the person never wrote', async () => {
    expect(await facts(A, NO_CHANNEL)).toEqual({
      channelType: null,
      lastCustomerMessageAt: null,
      officialMessagesSinceCustomer: 0,
    });
    expect(await facts(A, NEVER_WROTE)).toMatchObject({
      channelType: 'zalo_oa',
      officialMessagesSinceCustomer: 2,
    });
  });

  it('finds nothing of another organisation (RLS), and nothing for an id that does not exist', async () => {
    expect(await facts(B, WITH_CHANNEL)).toBeNull();
    expect(await facts(A, uuidv7())).toBeNull();
  });
});
