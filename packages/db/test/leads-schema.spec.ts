import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The tables of the leads (L1b, N188, N196, N200): what the database refuses on its own, before any store. Every RLS table is also
// covered by rls-all-tables.spec (cross-organisation read, O+W policies, no DELETE) and grants.spec (the UPDATE columns of app_role).
const [org, other] = [uuidv7(), uuidv7()];
const users: string[] = [];
const ids = {
  ws: '',
  ws2: '',
  stage: '',
  stage2: '',
  stageWs2: '',
  customer: '',
  otherCustomer: '',
  conversation: '',
  conversationWs2: '',
  lead: '',
};
let admin: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const o of [org, other]) users.push(await seedTenant(admin, o));
  const one = async (sql: string, o = org) =>
    (await admin.query<{ id: string }>(sql, [o])).rows[0]?.id as string;
  ids.ws = await one('SELECT id FROM workspaces WHERE org_id = $1');
  ids.stage = await one('SELECT id FROM pipeline_stages WHERE org_id = $1');
  ids.customer = await one('SELECT id FROM customers WHERE org_id = $1');
  ids.otherCustomer = await one('SELECT id FROM customers WHERE org_id = $1', other);
  ids.conversation = await one('SELECT id FROM conversations WHERE org_id = $1');
  ids.lead = await one('SELECT id FROM leads WHERE org_id = $1');
  [ids.ws2, ids.stage2, ids.stageWs2, ids.conversationWs2] = [
    uuidv7(),
    uuidv7(),
    uuidv7(),
    uuidv7(),
  ];
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')`,
    [ids.ws2, org],
  );
  await admin.query(
    `INSERT INTO pipeline_stages (id, org_id, workspace_id, name, position)
     VALUES ($1, $2, $3, 'Bước 2', 1), ($4, $2, $5, 'Bước 1', 0)`,
    [ids.stage2, org, ids.ws, ids.stageWs2, ids.ws2],
  );
  await admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state) VALUES ($1, $2, $3, 'BOT_ACTIVE')`,
    [ids.conversationWs2, org, ids.ws2],
  );
});

afterAll(async () => {
  await app.end();
  for (const [i, o] of [org, other].entries()) await cleanupTenant(admin, o, users[i] as string);
  await admin.end();
});

/** Inserts a row of `table` (as migration_role by default), `over` replacing columns; resolves to the SQLSTATE or undefined. */
function insert(
  table: 'leads' | 'lead_events',
  over: Record<string, unknown> = {},
  client = admin,
) {
  const base: Record<string, unknown> =
    table === 'leads'
      ? {
          id: uuidv7(),
          org_id: org,
          workspace_id: ids.ws,
          title: 'Báo giá 200 thùng',
          customer_id: ids.customer,
          stage_id: ids.stage,
          created_by: users[0],
        }
      : {
          id: uuidv7(),
          org_id: org,
          workspace_id: ids.ws,
          lead_id: ids.lead,
          type: 'stage_changed',
          from_stage_id: ids.stage,
          to_stage_id: ids.stage2,
          actor_user_id: users[0],
        };
  const row = { ...base, ...over };
  const cols = Object.keys(row);
  return sqlState(
    client.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row),
    ),
  );
}

const closed = { closed_at: new Date().toISOString() };

describe('leads', () => {
  it('takes a title of 1 to 200 characters, trimmed and in NFC, and nothing else', async () => {
    expect(await insert('leads', { title: 'x'.repeat(200) })).toBeUndefined();
    for (const title of ['', ' Báo giá', 'x'.repeat(201), 'Báo giá'.normalize('NFD')])
      expect(await insert('leads', { title }), title.slice(0, 20)).toBe('23514');
    // With a closing time and no reason, only the CHECK of the states refuses it (no other CHECK can catch it in its place).
    expect(await insert('leads', { status: 'pending', ...closed })).toBe('23514');
  });

  it('is open exactly while it has no closing time, and lost exactly when it has a reason', async () => {
    expect(await insert('leads', { status: 'won', ...closed })).toBeUndefined();
    expect(
      await insert('leads', { status: 'lost', lost_reason: 'Khác (chờ Q9)', ...closed }),
    ).toBeUndefined();
    for (const over of [
      { status: 'open', ...closed }, // open with a closing time
      { status: 'won' }, // closed without one
      { status: 'lost', lost_reason: 'Khác (chờ Q9)' },
      { status: 'lost', ...closed }, // lost without a reason
      { status: 'won', lost_reason: 'Khác (chờ Q9)', ...closed }, // a reason when not lost
      { lost_reason: 'Khác (chờ Q9)' }, // a reason while open
      { status: 'lost', lost_reason: ' Khác', ...closed },
      { status: 'lost', lost_reason: 'y'.repeat(201), ...closed },
      { status: 'lost', lost_reason: 'Hết hàng'.normalize('NFD'), ...closed },
      { version: -1 },
    ])
      expect(await insert('leads', over), JSON.stringify(over).slice(0, 60)).toBe('23514');
  });

  it('sits at a step and points at a conversation of its own workspace, of a customer of its organisation', async () => {
    // Same organisation, another workspace: the pair foreign keys refuse them, not only a key on the id.
    expect(await insert('leads', { stage_id: ids.stageWs2 })).toBe('23503');
    expect(await insert('leads', { conversation_id: ids.conversationWs2 })).toBe('23503');
    expect(await insert('leads', { conversation_id: ids.conversation })).toBeUndefined();
    expect(await insert('leads', { customer_id: ids.otherCustomer })).toBe('23503');
    expect(await insert('leads', { owner_user_id: users[1] })).toBe('23503');
    expect(await insert('leads', { created_by: users[1] })).toBe('23503');
    // In ws2, its own step is fine.
    expect(
      await insert('leads', { workspace_id: ids.ws2, stage_id: ids.stageWs2 }),
    ).toBeUndefined();
  });

  it('lets app_role change only the step, the state, the owner and the closing, and keeps the title from support_role', async () => {
    expect(await asApp(app, org, [ids.ws], () => insert('leads', {}, app))).toBeUndefined();
    expect(await asApp(app, org, [ids.ws2], () => insert('leads', {}, app))).toBe('42501');
    const update = (sql: string) =>
      asApp(app, org, [ids.ws], () => sqlState(app.query(sql, [ids.lead])));
    expect(
      await update('UPDATE leads SET stage_id = stage_id, version = version + 1 WHERE id = $1'),
    ).toBeUndefined();
    for (const column of ['title', 'customer_id', 'conversation_id', 'created_by', 'workspace_id'])
      expect(await update(`UPDATE leads SET ${column} = ${column} WHERE id = $1`), column).toBe(
        '42501',
      );
    const { rows } = await admin.query<{ column: string }>(
      `SELECT a.attname AS column FROM pg_attribute a
       WHERE a.attrelid = 'public.leads'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND NOT has_column_privilege('support_role', a.attrelid, a.attnum, 'SELECT') ORDER BY a.attname`,
    );
    expect(rows.map((r) => r.column)).toEqual(['title']);
  });
});

describe('lead_events', () => {
  it('holds codes only, in the shape of each type', async () => {
    for (const over of [
      { type: 'created', from_stage_id: null },
      { type: 'closed', from_stage_id: null, to_stage_id: null, outcome: 'lost' },
      { type: 'owner_changed', from_stage_id: null, to_stage_id: null },
      {},
    ])
      expect(await insert('lead_events', over), JSON.stringify(over)).toBeUndefined();
    for (const over of [
      { type: 'note', from_stage_id: null, to_stage_id: null }, // no step nor outcome: only the CHECK of the types refuses it
      { type: 'created' }, // a step it came from
      { to_stage_id: ids.stage }, // a change to the step it is at
      { from_stage_id: null }, // a change without the step before
      { outcome: 'won' }, // an outcome outside closing
      { type: 'closed', from_stage_id: null, to_stage_id: null }, // closing without an outcome
      { type: 'closed', from_stage_id: null, to_stage_id: null, outcome: 'cancelled' },
      { type: 'owner_changed' }, // steps on a change of owner
    ])
      expect(await insert('lead_events', over), JSON.stringify(over)).toBe('23514');
    const { rows } = await admin.query<{ column: string }>(
      `SELECT column_name AS column FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'lead_events' AND data_type = 'text' ORDER BY 1`,
    );
    expect(rows.map((r) => r.column)).toEqual(['outcome', 'type']);
  });

  it('ties an event to a lead and to steps of the lead’s own workspace', async () => {
    expect(await insert('lead_events', { lead_id: uuidv7() })).toBe('23503');
    expect(await insert('lead_events', { to_stage_id: ids.stageWs2 })).toBe('23503');
    expect(await insert('lead_events', { from_stage_id: ids.stageWs2 })).toBe('23503');
    expect(await insert('lead_events', { workspace_id: ids.ws2 })).toBe('23503');
    expect(await insert('lead_events', { actor_user_id: users[1] })).toBe('23503');
  });

  it('lets app_role add events of the workspaces it holds, and never change one', async () => {
    expect(await asApp(app, org, [ids.ws], () => insert('lead_events', {}, app))).toBeUndefined();
    expect(await asApp(app, org, [ids.ws2], () => insert('lead_events', {}, app))).toBe('42501');
    const sql = "UPDATE lead_events SET type = 'closed'";
    expect(await asApp(app, org, [ids.ws], () => sqlState(app.query(sql)))).toBe('42501');
  });
});
