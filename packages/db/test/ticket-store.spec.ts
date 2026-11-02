import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  changeTicket,
  createDbPool,
  createTicket,
  InvalidTicketAssigneeError,
  InvalidTicketTransitionError,
  TicketCancelForbiddenError,
  TicketNotFoundError,
  TicketReferenceNotFoundError,
  TicketVersionConflictError,
  withTenant,
  type TicketChange,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Making and changing a ticket (K1b-1, U27, N167, N170) through RLS, on PostgreSQL: the moves between states, who cancels, who may
// receive a ticket, the version a change was read at, and one event per kind of change.
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
const change = (id: string, version: number, c: TicketChange, actorRole = 'manager') =>
  inWs((tx) =>
    changeTicket(tx, { id, version, change: c, actorUserId: owner, actorRole, newId: uuidv7 }),
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

describe('changeTicket', () => {
  it('moves along U27 only, reopens a done ticket, and writes one event per kind of change', async () => {
    const t = await make();
    await expect(change(t.id, 0, { status: 'done' })).rejects.toBeInstanceOf(
      InvalidTicketTransitionError,
    );
    const started = await change(t.id, 0, {
      status: 'in_progress',
      assigneeUserId: person('support'),
      priority: 'urgent',
    });
    expect(started).toMatchObject({ status: 'in_progress', version: 1, priority: 'urgent' });
    const done = await change(t.id, 1, { status: 'done' });
    const reopened = await change(t.id, 2, { status: 'in_progress', title: 'Giao thiếu 3 thùng' });
    expect(reopened).toMatchObject({
      status: 'in_progress',
      version: 3,
      title: 'Giao thiếu 3 thùng',
    });
    expect(done.version).toBe(2);
    expect(await events(t.id)).toEqual([
      { type: 'created', from_status: null, to_status: 'new' },
      { type: 'status_changed', from_status: 'new', to_status: 'in_progress' },
      { type: 'assigned', from_status: null, to_status: null },
      { type: 'edited', from_status: null, to_status: null },
      { type: 'status_changed', from_status: 'in_progress', to_status: 'done' },
      { type: 'status_changed', from_status: 'done', to_status: 'in_progress' },
      { type: 'edited', from_status: null, to_status: null },
    ]);
    // Clearing the assignee is a change of assignee; the same values again are no event.
    await change(t.id, 3, { assigneeUserId: null, title: 'Giao thiếu 3 thùng' });
    expect((await events(t.id)).slice(-1)).toEqual([
      { type: 'assigned', from_status: null, to_status: null },
    ]);
  });

  it('lets only an Owner, Admin or Manager cancel, and nothing follows cancelled', async () => {
    const t = await make();
    await expect(change(t.id, 0, { status: 'cancelled' }, 'support')).rejects.toBeInstanceOf(
      TicketCancelForbiddenError,
    );
    const cancelled = await change(t.id, 0, { status: 'cancelled' }, 'admin');
    expect(cancelled.status).toBe('cancelled');
    for (const to of ['new', 'in_progress', 'done'] as const)
      await expect(change(t.id, 1, { status: to })).rejects.toBeInstanceOf(
        InvalidTicketTransitionError,
      );
  });

  it('refuses a change read at an old version, and of two changes at the same version keeps exactly one', async () => {
    const t = await make();
    await change(t.id, 0, { priority: 'high' });
    await expect(change(t.id, 0, { priority: 'urgent' })).rejects.toBeInstanceOf(
      TicketVersionConflictError,
    );
    const both = await Promise.allSettled([
      change(t.id, 1, { title: 'Một' }),
      change(t.id, 1, { title: 'Hai' }),
    ]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = both.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(TicketVersionConflictError);
  });

  it('refuses an assignee who cannot handle the ticket, and leaves it as it was', async () => {
    const t = await make();
    await expect(change(t.id, 0, { assigneeUserId: person('sales') })).rejects.toBeInstanceOf(
      InvalidTicketAssigneeError,
    );
    expect(await events(t.id)).toHaveLength(1);
  });

  it('does not find a ticket of another workspace or organisation', async () => {
    const t = await make();
    const other = (workspaces: string[], org: string) =>
      inWs(
        (tx) =>
          changeTicket(tx, {
            id: t.id,
            version: 0,
            change: { priority: 'high' },
            actorUserId: org === A ? owner : seedUsers.get(B)!,
            actorRole: 'owner',
            newId: uuidv7,
          }),
        workspaces,
        org,
      );
    await expect(other([ws2], A)).rejects.toBeInstanceOf(TicketNotFoundError);
    const wsB = (
      await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [B])
    ).rows[0]!.id;
    await expect(other([wsB], B)).rejects.toBeInstanceOf(TicketNotFoundError);
  });
});
