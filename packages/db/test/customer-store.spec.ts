import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  customerForContact,
  insertConversation,
  linkConversationCustomer,
  lockContact,
  withTenant,
  type TenantTx,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The customer of an inbound message (N165), on app_role with RLS: found or made by the Zalo user id of one OA, one customer for two
// first messages at once (under lockContact), the conversation's customer filled once, and what the tables refuse. RLS and the
// privileges of app_role on the two tables are checked with every other table (rls-all-tables.spec, grants.spec).
const [A, B] = [uuidv7(), uuidv7()];
let [userA, userB] = ['', ''];
let [WA, CA, CA2] = ['', '', ''];
let admin: pg.Client;
let pool: pg.Pool;

const inA = <T>(fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(pool, { orgId: A, workspaceIds: [WA] }, fn);
const resolve = (tx: TenantTx, externalUserId: string, channelAccountId = CA) =>
  customerForContact(tx, { channelAccountId, externalUserId, newId: uuidv7 });
const person = () => `zu-${uuidv7()}`;
// The SQLSTATE of a failure: Drizzle puts the driver's error in `cause`.
const sqlState = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => {
      const error = e as { code?: string; cause?: { code?: string } };
      return error.cause?.code ?? error.code;
    },
  );

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 4 });
  userA = await seedTenant(admin, A);
  userB = await seedTenant(admin, B);
  const one = async (sql: string) =>
    ((await admin.query<{ id: string }>(sql, [A])).rows[0] as { id: string }).id;
  WA = await one('SELECT id FROM workspaces WHERE org_id = $1');
  CA = await one('SELECT id FROM channel_accounts WHERE org_id = $1');
  CA2 = uuidv7();
  await admin.query(
    `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, app_id, oa_secret_key_enc)
     VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA 2', 'app-2', $5)`,
    [CA2, A, WA, `oa2-${A}`, randomBytes(32)],
  );
});

afterAll(async () => {
  await pool.end();
  await cleanupTenant(admin, A, userA);
  await cleanupTenant(admin, B, userB);
  await admin.end();
});

describe('customerForContact', () => {
  it('makes a customer with no name and an unverified Zalo identity the first time, and finds it afterwards', async () => {
    const who = person();
    const id = await inA((tx) => resolve(tx, who));
    expect(await inA((tx) => resolve(tx, who))).toBe(id);
    const { rows } = await admin.query(
      `SELECT c.org_id, c.display_name, c.phone_e164, c.human_only, i.identity_type, i.channel_account_id, i.verification
       FROM customers c JOIN customer_identities i ON i.customer_id = c.id WHERE c.id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        org_id: A,
        display_name: null,
        phone_e164: null,
        human_only: false,
        identity_type: 'zalo_uid',
        channel_account_id: CA,
        verification: 'unverified',
      },
    ]);
  });

  it('keeps the same user id of two OAs apart (Zalo ids are per OA), until a merge', async () => {
    const who = person();
    const [one, two] = [
      await inA((tx) => resolve(tx, who)),
      await inA((tx) => resolve(tx, who, CA2)),
    ];
    expect(one).not.toBe(two);
  });

  it('makes one customer from two first messages of one person at once: the second waits on lockContact', async () => {
    const who = person();
    const place = () =>
      inA(async (tx) => {
        await lockContact(tx, CA, who);
        await sleep(100); // both would make a customer without the lock
        return resolve(tx, who);
      });
    const [a, b] = await Promise.all([place(), place()]);
    expect(a).toBe(b);
    const { rows } = await admin.query(
      'SELECT count(*)::int AS n FROM customer_identities WHERE external_id = $1',
      [who],
    );
    expect(rows).toEqual([{ n: 1 }]);
  });
});

describe('linkConversationCustomer', () => {
  it('names the customer of a conversation that has none, and never replaces it', async () => {
    const who = person();
    const [first, other] = [
      await inA((tx) => resolve(tx, who)),
      await inA((tx) => resolve(tx, person())),
    ];
    const conversation = await inA((tx) =>
      insertConversation(tx, {
        id: uuidv7(),
        workspaceId: WA,
        state: 'BOT_ACTIVE',
        afterHoursHold: false,
        assignedUserId: null,
        closedAt: null,
        outcome: null,
        channel: { channelAccountId: CA, externalUserId: who },
      }),
    );
    expect(await inA((tx) => linkConversationCustomer(tx, conversation.id, first))).toBe(true);
    expect(await inA((tx) => linkConversationCustomer(tx, conversation.id, other))).toBe(false);
    const { rows } = await admin.query('SELECT customer_id FROM conversations WHERE id = $1', [
      conversation.id,
    ]);
    expect(rows).toEqual([{ customer_id: first }]);
  });

  it('refuses a customer of another organisation (the foreign key names the organisation)', async () => {
    const { rows } = await admin.query<{ id: string }>(
      'SELECT id FROM customers WHERE org_id = $1 LIMIT 1',
      [B],
    );
    const conversation = await admin.query<{ id: string }>(
      'SELECT id FROM conversations WHERE org_id = $1 AND customer_id IS NULL LIMIT 1',
      [A],
    );
    const link = inA((tx) =>
      linkConversationCustomer(tx, conversation.rows[0]?.id ?? '', rows[0]?.id ?? ''),
    );
    expect(await sqlState(link)).toBe('23503');
  });
});

describe('the customer tables', () => {
  it('refuse a phone not in E.164, an email in capitals, a Zalo identity without its OA and the same identity twice', async () => {
    const customer = await inA((tx) => resolve(tx, person()));
    const set = (column: string, value: string) =>
      sqlState(admin.query(`UPDATE customers SET ${column} = $1 WHERE id = $2`, [value, customer]));
    expect(await set('phone_e164', '0912345678')).toBe('23514');
    expect(await set('phone_e164', '+84912345678')).toBe('ok');
    expect(await set('email', 'An@Example.test')).toBe('23514');
    expect(await set('display_name', '  ')).toBe('23514');
    const identity = (channel: string | null, external: string) =>
      sqlState(
        admin.query(
          `INSERT INTO customer_identities (id, org_id, customer_id, identity_type, channel_account_id, external_id)
           VALUES ($1, $2, $3, 'zalo_uid', $4, $5)`,
          [uuidv7(), A, customer, channel, external],
        ),
      );
    expect(await identity(null, person())).toBe('23514');
    expect(await identity(CA, 'zu-seed')).toBe('23505');
  });
});
