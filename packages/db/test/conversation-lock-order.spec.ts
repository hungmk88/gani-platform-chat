import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyTransition,
  createDbPool,
  insertMessage,
  withTenant,
  type TenantContext,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Review AR-05: the lock order of a conversation (N107) holds for a transition too, not only for a message. The case that used to
// deadlock: an agent claims a conversation and sends a first reply in ONE transaction, while a customer's message comes in between.
//   tx1: claim (UPDATE of the row)                       -> holds the row
//   tx2: customer message: lock, then UPDATE of the row  -> holds the lock, waits for the row
//   tx1: agent's reply: lock                             -> waits for tx2: a deadlock (40P01), before applyTransition took the lock
// Now the claim takes the lock first, so tx2 waits on the lock and tx1 goes through.
const ORG = uuidv7();
let user = '';
let workspace = '';
let admin: pg.Client;
let pool: pg.Pool;
let ctx: TenantContext;

/** Locks being waited for right now (pg_locks can be read by any role, unlike the wait events of other roles). */
const waiting = async () =>
  Number(
    (
      await admin.query<{ n: string }>(
        // A wait on a row is a transactionid lock, whose database is NULL; an advisory lock carries the database.
        'SELECT count(*) AS n FROM pg_locks WHERE NOT granted AND (database IS NULL OR database = (SELECT oid FROM pg_database WHERE datname = current_database()))',
      )
    ).rows[0]?.n,
  );

async function until(check: () => Promise<boolean>, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out waiting for a transaction to block');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 4 });
  user = await seedTenant(admin, ORG);
  const ws = await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [
    ORG,
  ]);
  workspace = ws.rows[0]?.id as string;
  ctx = { orgId: ORG, workspaceIds: [workspace] };
});

afterAll(async () => {
  await pool.end();
  await cleanupTenant(admin, ORG, user);
  await admin.end();
});

describe('lock order of a conversation (review AR-05)', () => {
  it('lets a claim and a reply in one transaction run against a customer message, without a deadlock', async () => {
    const conversation = uuidv7();
    await admin.query(
      `INSERT INTO conversations (id, org_id, workspace_id, state) VALUES ($1, $2, $3, 'HUMAN_WAITING_Q')`,
      [conversation, ORG, workspace],
    );
    const message = (senderKind: 'agent' | 'customer') => ({
      id: uuidv7(),
      conversationId: conversation,
      workspaceId: workspace,
      senderKind,
      senderUserId: senderKind === 'agent' ? user : null,
      kind: 'text' as const,
      body: senderKind,
    });

    let claimed = (): void => undefined;
    let goOn = (): void => undefined;
    const afterClaim = new Promise<void>((resolve) => (claimed = resolve));
    const resume = new Promise<void>((resolve) => (goOn = resolve));

    const agent = withTenant(pool, ctx, async (tx) => {
      const row = await applyTransition(tx, {
        id: conversation,
        from: { state: 'HUMAN_WAITING_Q', afterHoursHold: false },
        // prettier-ignore
        next: { state: 'HUMAN_ACTIVE', afterHoursHold: false, assignedUserId: user, closedAt: null, outcome: null },
      });
      expect(row?.state).toBe('HUMAN_ACTIVE');
      claimed();
      await resume;
      return insertMessage(tx, message('agent'));
    });
    await afterClaim;
    const before = await waiting();
    const customer = withTenant(pool, ctx, (tx) => insertMessage(tx, message('customer')));
    await until(async () => (await waiting()) > before);
    goOn();

    const results = await Promise.allSettled([agent, customer]);
    // The SQLSTATE of a failure (Drizzle puts the driver's error in `cause`): 40P01 is the deadlock this test is about.
    const codes = results.map((r) => {
      if (r.status === 'fulfilled') return 'ok';
      const e = r.reason as { code?: string; cause?: { code?: string } };
      return e.code ?? e.cause?.code ?? 'error';
    });
    expect(codes).toEqual(['ok', 'ok']);
    const { rows } = await admin.query<{ sender_kind: string; sequence_number: number }>(
      'SELECT sender_kind, sequence_number::int AS sequence_number FROM messages WHERE conversation_id = $1 ORDER BY sequence_number',
      [conversation],
    );
    expect(rows).toEqual([
      { sender_kind: 'agent', sequence_number: 1 },
      { sender_kind: 'customer', sequence_number: 2 },
    ]);
    const state = await admin.query('SELECT state FROM conversations WHERE id = $1', [
      conversation,
    ]);
    expect(state.rows).toEqual([{ state: 'HUMAN_ACTIVE' }]);
  });
});
