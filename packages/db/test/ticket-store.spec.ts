import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  createTicket,
  InvalidTicketAssigneeError,
  TicketReferenceNotFoundError,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Making a ticket (K1b-1, U27, N167, N170) through RLS, on PostgreSQL: its created event, who may receive it, and what it may point
// to. Changing one is K1b-2.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const people: Record<string, string> = {};
let admin: pg.Client;
let pool: pg.Pool;
let [ws, ws2, owner, conversation, customerB] = ['', '', '', '', ''];
const inWs = <T>(fn: Parameters<typeof withTenant<T>>[2], workspaces = [ws], org = A) =>
  withTenant(pool, { orgId: org, workspaceIds: workspaces }, fn);
const make = (over: Partial<Parameters<typeof createTicket>[1]> = {}) =>
  inWs((tx) =>
    createTicket(tx, {
      workspaceId: ws,
      title: 'Giao thiếu 2 thùng',
      createdBy: owner,
      newId: uuidv7,
      ...over,
    }),
  );
const person = (name: string): string => {
  const id = people[name];
  if (!id) throw new Error(`no person ${name}`);
  return id;
};
const events = async (ticket: string) =>
  (
    await admin.query<{ type: string; from_status: string | null; to_status: string | null }>(
      'SELECT type, from_status, to_status FROM ticket_events WHERE ticket_id = $1 ORDER BY occurred_at, id',
      [ticket],
    )
  ).rows;

/** A member of A with `role`, in workspace `in` when given, active unless `status` says otherwise. */
async function member(name: string, role: string, inWorkspace: string | null, status = 'active') {
  const id = (people[name] = uuidv7());
  await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
    id,
    `${id}@example.test`,
  ]);
  await admin.query(
    'INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, $5)',
    [uuidv7(), A, id, role, status],
  );
  if (inWorkspace)
    await admin.query(
      'INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)',
      [uuidv7(), A, inWorkspace, id],
    );
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 3 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  owner = seedUsers.get(A)!;
  const one = async (q: string, org: string) =>
    (await admin.query<{ id: string }>(q, [org])).rows[0]!.id;
  ws = await one('SELECT id FROM workspaces WHERE org_id = $1', A);
  conversation = await one('SELECT id FROM conversations WHERE org_id = $1', A);
  customerB = await one('SELECT id FROM customers WHERE org_id = $1', B);
  ws2 = uuidv7();
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws-tk', 'W2', 'service')`,
    [ws2, A],
  );
  await member('support', 'support', ws);
  await member('sales', 'sales', ws);
  await member('elsewhere', 'support', ws2);
  await member('suspended', 'support', ws, 'suspended');
});

afterAll(async () => {
  await pool.end();
  for (const p of Object.values(people)) {
    await admin.query('DELETE FROM ticket_events WHERE org_id = $1', [A]);
    await admin.query('DELETE FROM tickets WHERE org_id = $1', [A]);
    await admin.query('DELETE FROM workspace_members WHERE user_id = $1', [p]);
    await admin.query('DELETE FROM org_members WHERE user_id = $1', [p]);
    await admin.query('DELETE FROM users WHERE id = $1', [p]);
  }
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('createTicket', () => {
  it('makes a ticket in state new, version 0, with its created event', async () => {
    const t = await make({ conversationId: conversation, priority: 'high' });
    expect(t).toMatchObject({
      workspaceId: ws,
      status: 'new',
      priority: 'high',
      version: 0,
      conversationId: conversation,
      createdBy: owner,
      assigneeUserId: null,
      type: null,
      slaDueAt: null,
    });
    expect(await events(t.id)).toEqual([{ type: 'created', from_status: null, to_status: 'new' }]);
  });

  it('refuses a customer of another organisation and a conversation of another workspace, and writes nothing', async () => {
    const before = await admin.query('SELECT count(*) FROM tickets WHERE org_id = $1', [A]);
    await expect(make({ customerId: customerB })).rejects.toBeInstanceOf(
      TicketReferenceNotFoundError,
    );
    await expect(
      inWs(
        (tx) =>
          createTicket(tx, {
            workspaceId: ws2,
            title: 'X',
            conversationId: conversation,
            createdBy: owner,
            newId: uuidv7,
          }),
        [ws2],
      ),
    ).rejects.toBeInstanceOf(TicketReferenceNotFoundError);
    const after = await admin.query('SELECT count(*) FROM tickets WHERE org_id = $1', [A]);
    expect(after.rows).toEqual(before.rows);
  });

  it('gives a ticket only to an active Owner, Admin, Manager or Support of its workspace (U52, N170)', async () => {
    expect(await make({ assigneeUserId: person('support') })).toMatchObject({
      assigneeUserId: person('support'),
    });
    for (const who of ['sales', 'elsewhere', 'suspended'])
      await expect(make({ assigneeUserId: person(who) }), who).rejects.toBeInstanceOf(
        InvalidTicketAssigneeError,
      );
    await expect(make({ assigneeUserId: seedUsers.get(B) ?? '' })).rejects.toBeInstanceOf(
      InvalidTicketAssigneeError,
    );
  });
});
