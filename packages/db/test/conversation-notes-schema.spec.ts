import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The table of the internal notes of a conversation (C6-1, N194): what the database refuses on its own, before any store. Every RLS
// table is also covered by rls-all-tables.spec (cross-organisation read, no DELETE) and grants.spec (no UPDATE column of app_role).
const [org, other] = [uuidv7(), uuidv7()];
const users: string[] = [];
const ids = { ws: '', ws2: '', conversation: '', otherConversation: '' };
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
  ids.otherConversation = await one('SELECT id FROM conversations WHERE org_id = $1', [other]);
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

/** A note of `org` on its conversation (as migration_role), with `over` replacing columns; resolves to the SQLSTATE or undefined. */
function insertNote(over: Record<string, string> = {}, client = admin) {
  const row: Record<string, string> = {
    id: uuidv7(),
    org_id: org,
    conversation_id: ids.conversation,
    author_user_id: users[0] as string,
    body: 'Khách hẹn gọi lại chiều nay',
    ...over,
  };
  const cols = Object.keys(row);
  return sqlState(
    client.query(
      `INSERT INTO conversation_notes (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row),
    ),
  );
}

describe('conversation_notes', () => {
  it('takes a note or a transfer reason of 1 to 2000 (500) characters in NFC, and nothing else', async () => {
    expect(await insertNote()).toBeUndefined();
    expect(await insertNote({ body: 'x'.repeat(2000) })).toBeUndefined();
    expect(await insertNote({ kind: 'transfer_reason', body: 'y'.repeat(500) })).toBeUndefined();
    for (const over of [
      { body: '   ' },
      { body: 'x'.repeat(2001) },
      { kind: 'transfer_reason', body: 'y'.repeat(501) },
      { body: 'Ghi chú'.normalize('NFD') },
      { kind: 'mention' },
    ])
      expect(await insertNote(over), JSON.stringify(over).slice(0, 60)).toBe('23514');
  });

  it('ties a note to a conversation and an author of its own organisation', async () => {
    expect(await insertNote({ conversation_id: ids.otherConversation })).toBe('23503');
    expect(await insertNote({ author_user_id: users[1] as string })).toBe('23503');
  });

  it('lets app_role read and write only the notes of a conversation it sees, and never change one', async () => {
    const seen = (workspaces: string[], tenant = org) =>
      asApp(
        app,
        tenant,
        workspaces,
        async () =>
          (
            await app.query('SELECT 1 FROM conversation_notes WHERE conversation_id = $1', [
              ids.conversation,
            ])
          ).rowCount,
      );
    expect(await seen([ids.ws])).toBeGreaterThan(0);
    expect(await seen([ids.ws2])).toBe(0);
    expect(await seen([ids.ws], other)).toBe(0);
    expect(await asApp(app, org, [ids.ws], () => insertNote({}, app))).toBeUndefined();
    // WITH CHECK: no note on a conversation of a workspace the session does not hold.
    expect(await asApp(app, org, [ids.ws2], () => insertNote({}, app))).toBe('42501');
    for (const sql of [
      "UPDATE conversation_notes SET body = 'x'",
      "UPDATE conversation_notes SET kind = 'note'",
    ])
      expect(await asApp(app, org, [ids.ws], () => sqlState(app.query(sql))), sql).toBe('42501');
  });

  it('keeps the words of a note away from support_role', async () => {
    const { rows } = await admin.query<{ column: string }>(
      `SELECT a.attname AS column FROM pg_attribute a
       WHERE a.attrelid = 'public.conversation_notes'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND NOT has_column_privilege('support_role', a.attrelid, a.attnum, 'SELECT') ORDER BY a.attname`,
    );
    expect(rows.map((r) => r.column)).toEqual(['body']);
  });
});
