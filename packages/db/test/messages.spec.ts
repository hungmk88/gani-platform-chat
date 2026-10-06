import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// `messages` (M1.2 PR1): O+W like conversations, append-only, partitioned by month. Org A has two workspaces (WA, WB), one
// conversation and one message in each; org B only exists to be a foreign tenant.
const [A, B] = [uuidv7(), uuidv7()];
const [WB, CB, MA, MB] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const users = new Map<string, string>();
let WA = '';
let CA = '';
let admin: pg.Client;
let app: pg.Client;

const insertSql = `INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()))`;
const row = (
  workspace: string,
  conversation: string,
  over: { id?: string; seq?: number; sender?: string; kind?: string; at?: string } = {},
) => [
  over.id ?? uuidv7(),
  A,
  workspace,
  conversation,
  over.seq ?? 2,
  over.sender ?? 'bot',
  over.kind ?? 'text',
  over.at ?? null,
];
const ids = async () =>
  (await app.query<{ id: string }>('SELECT id FROM messages')).rows.map((r) => r.id);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  const first = await admin.query<{ w: string; c: string }>(
    'SELECT workspace_id AS w, id AS c FROM conversations WHERE org_id = $1',
    [A],
  );
  [WA, CA] = [first.rows[0]?.w as string, first.rows[0]?.c as string];
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws-b', 'WB', 'service')`,
    [WB, A],
  );
  await admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state) VALUES ($1, $2, $3, 'BOT_ACTIVE')`,
    [CB, A, WB],
  );
  await admin.query(insertSql, [MA, ...row(WA, CA, { seq: 5 }).slice(1)]);
  await admin.query(insertSql, [MB, ...row(WB, CB, { seq: 5 }).slice(1)]);
});

afterAll(async () => {
  await app.end();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('workspace isolation of messages', () => {
  it('with {WA} shows the messages of WA and never those of WB (same org)', async () => {
    const seen = await asApp(app, A, [WA], ids);
    expect(seen).toContain(MA);
    expect(seen).not.toContain(MB);
  });

  it('with both workspaces both are visible; with {} nothing is', async () => {
    expect(await asApp(app, A, [WA, WB], ids)).toEqual(expect.arrayContaining([MA, MB]));
    expect(await asApp(app, A, [], ids)).toEqual([]);
  });

  it('without a context, or with an org and no workspaces, it raises TN001', async () => {
    expect(await sqlState(app.query('SELECT 1 FROM messages'))).toBe('TN001');
    expect(await sqlState(asApp(app, A, null, ids))).toBe('TN001');
  });

  it('with {WA} an INSERT into WA works (control) and one into WB is refused (42501)', async () => {
    expect(await sqlState(asApp(app, A, [WA], () => app.query(insertSql, row(WA, CA))))).toBe(
      undefined,
    );
    expect(await sqlState(asApp(app, A, [WA], () => app.query(insertSql, row(WB, CB))))).toBe(
      '42501',
    );
  });

  it('is append-only for app_role: UPDATE and DELETE are refused (42501)', async () => {
    const update = () => app.query("UPDATE messages SET body = 'edited' WHERE id = $1", [MA]);
    expect(await sqlState(asApp(app, A, [WA], update))).toBe('42501');
    expect(await sqlState(asApp(app, A, [WA], () => app.query('DELETE FROM messages')))).toBe(
      '42501',
    );
  });
});

describe('the columns of messages', () => {
  it('refuses a workspace that is not the one of the conversation (23503)', async () => {
    expect(await sqlState(admin.query(insertSql, row(WB, CA)))).toBe('23503');
  });

  it.each([
    ['sender_kind', { sender: 'robot' }],
    ['kind', { kind: 'gif' }],
    ['sequence_number', { seq: 0 }],
  ])('refuses a bad %s (23514)', async (_name, over) => {
    expect(await sqlState(admin.query(insertSql, row(WA, CA, over)))).toBe('23514');
  });

  it('refuses a blank platform_message_id (23514) and accepts none', async () => {
    const sql = `INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, platform_message_id)
      VALUES ($1, $2, $3, $4, 3, 'customer', 'text', $5)`;
    expect(await sqlState(admin.query(sql, [uuidv7(), A, WA, CA, '  ']))).toBe('23514');
    expect(await sqlState(admin.query(sql, [uuidv7(), A, WA, CA, null]))).toBe(undefined);
  });
});

describe('partitions and index', () => {
  it('routes a row to the monthly partition of its date, an old date to DEFAULT', async () => {
    const [recent, old] = [uuidv7(), uuidv7()];
    await admin.query(insertSql, row(WA, CA, { id: recent, seq: 7 }));
    await admin.query(insertSql, row(WA, CA, { id: old, seq: 8, at: '2001-01-01T00:00:00Z' }));
    const { rows } = await admin.query<{ id: string; t: string }>(
      'SELECT id, tableoid::regclass::text AS t FROM messages WHERE id = ANY($1::uuid[])',
      [[recent, old]],
    );
    const at = (id: string) => rows.find((r) => r.id === id)?.t;
    expect(at(recent)).toMatch(/^messages_y\d{4}m\d{2}$/);
    expect(at(old)).toBe('messages_default');
  });

  it('has the (org, conversation, sequence) index on the parent and on a partition', async () => {
    const { rows } = await admin.query<{ tablename: string }>(
      `SELECT tablename FROM pg_indexes WHERE schemaname = 'public'
       AND (tablename = 'messages' OR tablename LIKE 'messages\\_y%')
       AND indexdef LIKE '%(org_id, conversation_id, sequence_number)%'`,
    );
    expect(rows.map((r) => r.tablename)).toContain('messages');
    expect(rows.length).toBeGreaterThan(1);
  });
});
