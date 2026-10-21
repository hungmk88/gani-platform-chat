import { setTimeout as sleep } from 'node:timers/promises';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  channelAccountForWebhook,
  createDbPool,
  findConversationForContact,
  insertConversation,
  lockContact,
  withTenant,
  type TenantTx,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Where the inbound processor puts a customer's message (inbound spec §3): the lock of one person of one channel account, the lookup of
// that person's conversation, a conversation created with its channel, and the channel account a webhook names (N105).
const A = uuidv7();
let user = '';
let [WA, CA] = ['', ''];
let admin: pg.Client;
let pool: pg.Pool;

const inA = <T>(fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(pool, { orgId: A, workspaceIds: [WA] }, fn);
const fsm = {
  state: 'BOT_ACTIVE',
  afterHoursHold: false,
  assignedUserId: null,
  closedAt: null,
  outcome: null,
};
const create = (tx: TenantTx, person: string) =>
  insertConversation(tx, {
    id: uuidv7(),
    workspaceId: WA,
    ...fsm,
    channel: { channelAccountId: CA, externalUserId: person },
  });
const closed = (person: string, hoursAgo: number) =>
  admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state, closed_at, outcome, channel_account_id, external_user_id)
     VALUES ($1, $2, $3, 'CLOSED', now() - make_interval(hours => $4), 'resolved', $5, $6) RETURNING id`,
    [uuidv7(), A, WA, hoursAgo, CA, person],
  );
const person = () => `zu-${uuidv7()}`;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 4 });
  user = await seedTenant(admin, A);
  const one = async (sql: string) =>
    ((await admin.query<{ id: string }>(sql, [A])).rows[0] as { id: string }).id;
  WA = await one('SELECT id FROM workspaces WHERE org_id = $1');
  CA = await one('SELECT id FROM channel_accounts WHERE org_id = $1');
});

afterAll(async () => {
  await pool.end();
  await admin.query(
    'DELETE FROM conversations WHERE org_id = $1 AND channel_account_id IS NOT NULL',
    [A],
  );
  await cleanupTenant(admin, A, user);
  await admin.end();
});

describe('a conversation of a person of a channel account', () => {
  it('is created with both columns', async () => {
    const who = person();
    const row = await inA((tx) => create(tx, who));
    const { rows } = await admin.query(
      'SELECT channel_account_id, external_user_id FROM conversations WHERE id = $1',
      [row.id],
    );
    expect(rows).toEqual([{ channel_account_id: CA, external_user_id: who }]);
  });

  it('is found open first, else the latest closed, else not at all', async () => {
    const who = person();
    expect(await inA((tx) => findConversationForContact(tx, CA, who))).toBeNull();
    await closed(who, 100);
    const recent = (await closed(who, 2)).rows[0] as { id: string };
    expect(await inA((tx) => findConversationForContact(tx, CA, who))).toMatchObject({
      id: recent.id,
      state: 'CLOSED',
    });
    const open = await inA((tx) => create(tx, who));
    expect(await inA((tx) => findConversationForContact(tx, CA, who))).toMatchObject({
      id: open.id,
      state: 'BOT_ACTIVE',
    });
    expect(await inA((tx) => findConversationForContact(tx, CA, person()))).toBeNull();
  });

  it('gets one conversation from two messages of one person at once: the second waits on the lock and finds the first', async () => {
    const who = person();
    const place = () =>
      inA(async (tx) => {
        await lockContact(tx, CA, who);
        const found = await findConversationForContact(tx, CA, who);
        await sleep(150); // both would have found nothing without the lock
        return found ?? (await create(tx, who));
      });
    const [a, b] = await Promise.all([place(), place()]);
    expect(a.id).toBe(b.id);
    const { rows } = await admin.query(
      'SELECT count(*)::int AS n FROM conversations WHERE external_user_id = $1',
      [who],
    );
    expect(rows).toEqual([{ n: 1 }]);
  });
});

describe('channelAccountForWebhook', () => {
  it('gives the organisation, the workspace and the ciphertexts of a known account, null for an unknown one', async () => {
    expect(await channelAccountForWebhook(pool, CA)).toMatchObject({
      orgId: A,
      workspaceId: WA,
      type: 'zalo_oa',
      keyVersion: 1,
      oaSecretKeyEnc: expect.any(Buffer) as Buffer,
    });
    expect(await channelAccountForWebhook(pool, uuidv7())).toBeNull();
    await expect(channelAccountForWebhook(pool, "x' OR 1=1 --")).rejects.toThrow(
      /channelAccountId/,
    );
  });
});
