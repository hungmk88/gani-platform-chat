import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The tables of the tickets (K1a, U27, N167, N170): what the database refuses on its own, before any store. Every RLS table is
// also covered by rls-all-tables.spec (cross-organisation read, no DELETE) and grants.spec (the UPDATE columns of app_role).
const [org, other] = [uuidv7(), uuidv7()];
const users: string[] = [];
const ids = { ws: '', ws2: '', otherCustomer: '', conversation: '', customer: '' };
let admin: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const o of [org, other]) users.push(await seedTenant(admin, o));
  const one = async (sql: string, params: string[]) =>
    (await admin.query<{ id: string }>(sql, params)).rows[0]?.id as string;
  ids.ws = await one('SELECT id FROM workspaces WHERE org_id = $1', [org]);
  ids.conversation = await one('SELECT id FROM conversations WHERE org_id = $1', [org]);
  ids.customer = await one('SELECT id FROM customers WHERE org_id = $1', [org]);
  ids.otherCustomer = await one('SELECT id FROM customers WHERE org_id = $1', [other]);
  ids.ws2 = uuidv7();
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')`,
    [ids.ws2, org],
  );
});

afterAll(async () => {
  await app.end();
  for (const [i, o] of [org, other].entries()) await cleanupTenant(admin, o, users[i] as string);
  await admin.end();
});

/** A ticket of `org` in `ws` (as migration_role), with `over` replacing columns; resolves to the SQLSTATE or undefined. */
function insertTicket(over: Record<string, string | null> = {}, client = admin) {
  const row: Record<string, string | null> = {
    id: uuidv7(),
    org_id: org,
    workspace_id: ids.ws,
    title: 'Giao thiếu hàng',
    created_by: users[0] as string,
    ...over,
  };
  const cols = Object.keys(row);
  return sqlState(
    client.query(
      `INSERT INTO tickets (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row),
    ),
  );
}

describe('tickets', () => {
  it('takes the five states of U27 and the three priorities of C8, nothing else', async () => {
    for (const status of ['new', 'in_progress', 'waiting_customer', 'done', 'cancelled'])
      expect(await insertTicket({ status })).toBeUndefined();
    for (const priority of ['normal', 'high', 'urgent'])
      expect(await insertTicket({ priority })).toBeUndefined();
    expect(await insertTicket({ status: 'open' })).toBe('23514');
    expect(await insertTicket({ priority: 'low' })).toBe('23514');
    expect(await insertTicket({ title: '  ' })).toBe('23514');
    expect(await insertTicket({ sla_paused_reason: 'lunch' })).toBe('23514');
  });

  it('never points into another organisation or workspace', async () => {
    expect(
      await insertTicket({ customer_id: ids.customer, conversation_id: ids.conversation }),
    ).toBeUndefined();
    expect(await insertTicket({ customer_id: ids.otherCustomer })).toBe('23503');
    // The conversation is of workspace ws: a ticket of ws2 cannot hold it.
    expect(await insertTicket({ workspace_id: ids.ws2, conversation_id: ids.conversation })).toBe(
      '23503',
    );
    expect(await insertTicket({ assignee_user_id: users[1] as string })).toBe('23503');
    expect(await insertTicket({ created_by: users[1] as string })).toBe('23503');
  });

  it('is read and written by app_role only inside its organisation and workspaces', async () => {
    const id = uuidv7();
    expect(await insertTicket({ id })).toBeUndefined();
    const seen = (workspaces: string[], tenant = org) =>
      asApp(
        app,
        tenant,
        workspaces,
        async () => (await app.query('SELECT id FROM tickets WHERE id = $1', [id])).rowCount,
      );
    expect(await seen([ids.ws])).toBe(1);
    expect(await seen([ids.ws2])).toBe(0);
    expect(await seen([ids.ws], other)).toBe(0);
    // WITH CHECK: a ticket cannot be made into a workspace the session does not hold.
    const written = await asApp(app, org, [ids.ws2], () => insertTicket({}, app));
    expect(written).toBe('42501');
  });

  it('keeps the free words away from support_role, and the columns waiting for Q7 and Q8 away from app_role', async () => {
    const { rows } = await admin.query<{ column: string }>(
      `SELECT a.attname AS column FROM pg_attribute a
       WHERE a.attrelid = 'public.tickets'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND NOT has_column_privilege('support_role', a.attrelid, a.attnum, 'SELECT') ORDER BY a.attname`,
    );
    expect(rows.map((r) => r.column)).toEqual(['description', 'title']);
    for (const sql of [
      "UPDATE tickets SET type = 'x'",
      'UPDATE tickets SET sla_due_at = now()',
      'UPDATE tickets SET customer_id = NULL',
      'UPDATE tickets SET created_by = created_by',
    ])
      expect(await asApp(app, org, [ids.ws], () => sqlState(app.query(sql))), sql).toBe('42501');
  });
});

describe('ticket_events', () => {
  const insertEvent = async (type: string, from: string | null, to: string | null) => {
    const ticket = uuidv7();
    await insertTicket({ id: ticket });
    return sqlState(
      admin.query(
        `INSERT INTO ticket_events (id, org_id, workspace_id, ticket_id, type, from_status, to_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uuidv7(), org, ids.ws, ticket, type, from, to],
      ),
    );
  };

  it('holds codes only: no column of free words', async () => {
    const { rows } = await admin.query<{ column: string }>(
      `SELECT column_name AS column FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ticket_events' ORDER BY ordinal_position`,
    );
    expect(rows.map((r) => r.column)).toEqual([
      'id',
      'org_id',
      'workspace_id',
      'ticket_id',
      'type',
      'from_status',
      'to_status',
      'actor_user_id',
      'occurred_at',
    ]);
  });

  it('gives states to a change of state only, in the shape of each type', async () => {
    expect(await insertEvent('created', null, 'new')).toBeUndefined();
    expect(await insertEvent('status_changed', 'new', 'in_progress')).toBeUndefined();
    expect(await insertEvent('assigned', null, null)).toBeUndefined();
    expect(await insertEvent('edited', null, null)).toBeUndefined();
    expect(await insertEvent('created', null, 'done')).toBe('23514');
    expect(await insertEvent('status_changed', 'new', 'new')).toBe('23514');
    expect(await insertEvent('status_changed', null, 'done')).toBe('23514');
    expect(await insertEvent('assigned', 'new', 'done')).toBe('23514');
    expect(await insertEvent('status_changed', 'new', 'open')).toBe('23514');
    expect(await insertEvent('commented', null, null)).toBe('23514');
  });
});
