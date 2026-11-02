import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  changeTicket,
  createDbPool,
  createTicket,
  InvalidCursorError,
  listTickets,
  loadTicket,
  ticketNames,
  withTenant,
  type TicketQuery,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Reading tickets (K1b-3, U53, N170) through RLS on PostgreSQL: newest first with a cursor that neither repeats nor skips, the
// filters of GET /v1/tickets, a Sales reading only what they made, and nothing of another workspace or organisation.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;
let [ws, ws2, owner, conversation, salesId] = ['', '', '', '', ''];
const ids: string[] = [];
const inWs = <T>(fn: Parameters<typeof withTenant<T>>[2], workspaces = [ws, ws2], org = A) =>
  withTenant(pool, { orgId: org, workspaceIds: workspaces }, fn);
const list = (q: Partial<TicketQuery> = {}, workspaces?: string[]) =>
  inWs((tx) => listTickets(tx, { limit: 50, ...q }), workspaces);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  owner = seedUsers.get(A)!;
  const one = async (q: string, org: string) =>
    (await admin.query<{ id: string }>(q, [org])).rows[0]!.id;
  ws = await one('SELECT id FROM workspaces WHERE org_id = $1', A);
  conversation = await one('SELECT id FROM conversations WHERE org_id = $1', A);
  ws2 = uuidv7();
  salesId = uuidv7();
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws-tr', 'W2', 'service')`,
    [ws2, A],
  );
  await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
    salesId,
    `${salesId}@example.test`,
  ]);
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', 'active')`,
    [uuidv7(), A, salesId],
  );
  // The seed ticket of fixtures.ts is out of the way: this test reads only its own.
  await admin.query('DELETE FROM ticket_events WHERE org_id = $1', [A]);
  await admin.query('DELETE FROM tickets WHERE org_id = $1', [A]);
  // Five tickets of ws, one a minute apart, the first made the newest (so the order is by created_at, not by the time-ordered id), and one of ws2; the third by the Sales, on the conversation, assigned.
  for (let i = 0; i < 5; i++) {
    const t = await inWs((tx) =>
      createTicket(tx, {
        workspaceId: ws,
        title: `T${i}`,
        createdBy: i === 2 ? salesId : owner,
        ...(i === 2 && { conversationId: conversation, assigneeUserId: owner }),
        newId: uuidv7,
      }),
    );
    await admin.query(
      `UPDATE tickets SET created_at = now() - make_interval(mins => $2) WHERE id = $1`,
      [t.id, i + 1],
    );
    ids.push(t.id);
  }
  await inWs((tx) =>
    createTicket(tx, { workspaceId: ws2, title: 'W2', createdBy: owner, newId: uuidv7 }),
  );
  await inWs((tx) =>
    changeTicket(tx, {
      id: ids[4]!,
      version: 0,
      change: { status: 'in_progress' },
      actorUserId: owner,
      actorRole: 'owner',
      newId: uuidv7,
    }),
  );
});

afterAll(async () => {
  await pool.end();
  await admin.query('DELETE FROM ticket_events WHERE org_id = $1', [A]);
  await admin.query('DELETE FROM tickets WHERE org_id = $1', [A]);
  await admin.query('DELETE FROM org_members WHERE user_id = $1', [salesId]);
  await admin.query('DELETE FROM users WHERE id = $1', [salesId]);
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('listTickets', () => {
  it('reads newest first, a page at a time, never repeating nor skipping a ticket', async () => {
    const first = await list({ workspaceId: ws, limit: 2 });
    expect(first.rows.map((r) => r.id)).toEqual([ids[0], ids[1]]);
    const second = await list({ workspaceId: ws, limit: 2, cursor: first.nextCursor! });
    const third = await list({ workspaceId: ws, limit: 2, cursor: second.nextCursor! });
    expect([...second.rows, ...third.rows].map((r) => r.id)).toEqual([ids[2], ids[3], ids[4]]);
    expect(third.nextCursor).toBeNull();
    // Exactly `limit` left: the page is the last one, no cursor.
    expect((await list({ workspaceId: ws, limit: 5 })).nextCursor).toBeNull();
  });

  it('filters by workspace, state, assignee, conversation and maker', async () => {
    expect((await list()).rows).toHaveLength(6);
    expect((await list({ status: 'in_progress' })).rows.map((r) => r.id)).toEqual([ids[4]]);
    expect((await list({ assignee: owner })).rows.map((r) => r.id)).toEqual([ids[2]]);
    expect((await list({ workspaceId: ws, assignee: 'none' })).rows).toHaveLength(4);
    expect((await list({ conversationId: conversation })).rows.map((r) => r.id)).toEqual([ids[2]]);
    // A Sales reads only the tickets they made.
    expect((await list({ createdBy: salesId })).rows.map((r) => r.id)).toEqual([ids[2]]);
  });

  it('reads nothing of a workspace or an organisation the transaction does not hold', async () => {
    expect((await list({}, [ws2])).rows.map((r) => r.title)).toEqual(['W2']);
    const wsB = (
      await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [B])
    ).rows[0]!.id;
    const inB = await withTenant(pool, { orgId: B, workspaceIds: [wsB] }, (tx) =>
      listTickets(tx, { limit: 50 }),
    );
    expect(inB.rows.map((r) => r.title)).toEqual(['Seed']);
  });

  it('refuses a wrong limit, state or cursor before reading', async () => {
    await expect(list({ limit: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(list({ limit: 101 })).rejects.toBeInstanceOf(RangeError);
    await expect(list({ status: 'open' as never })).rejects.toBeInstanceOf(RangeError);
    await expect(list({ cursor: 'not-ours' })).rejects.toBeInstanceOf(InvalidCursorError);
  });
});

describe('loadTicket', () => {
  it('reads a ticket with its events oldest first, and nothing outside the transaction’s workspaces', async () => {
    // An event written later with an earlier time still comes first: the order is by time, not by insertion.
    await admin.query(
      `INSERT INTO ticket_events (id, org_id, workspace_id, ticket_id, type, occurred_at)
       VALUES ($1, $2, $3, $4, 'edited', now() - interval '1 hour')`,
      [uuidv7(), A, ws, ids[4]],
    );
    const t = await inWs((tx) => loadTicket(tx, ids[4]!));
    expect(t).toMatchObject({ id: ids[4], status: 'in_progress', version: 1 });
    expect(t?.events.map((e) => [e.type, e.fromStatus, e.toStatus])).toEqual([
      ['edited', null, null],
      ['created', null, 'new'],
      ['status_changed', 'new', 'in_progress'],
    ]);
    expect(await inWs((tx) => loadTicket(tx, ids[4]!), [ws2])).toBeNull();
    expect(await inWs((tx) => loadTicket(tx, uuidv7()))).toBeNull();
  });
});

describe('ticketNames', () => {
  it('names the customers and the active people of the tickets, and nobody of another organisation', async () => {
    const customer = (
      await admin.query<{ id: string }>('SELECT id FROM customers WHERE org_id = $1', [A])
    ).rows[0]!.id;
    await admin.query(`UPDATE users SET display_name = ' Chị Lan ' WHERE id = $1`, [owner]);
    const names = await inWs((tx) =>
      ticketNames(tx, [
        { customerId: customer, assigneeUserId: owner },
        { customerId: null, assigneeUserId: salesId },
        { customerId: uuidv7(), assigneeUserId: seedUsers.get(B)! },
      ]),
    );
    expect([...names.customers.keys()]).toEqual([customer]);
    expect(Object.fromEntries(names.people)).toEqual({ [owner]: 'Chị Lan', [salesId]: null });
    expect(await inWs((tx) => ticketNames(tx, []))).toEqual({
      customers: new Map(),
      people: new Map(),
    });
  });
});
