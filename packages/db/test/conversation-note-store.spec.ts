import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addConversationNote,
  createDbPool,
  listConversationNotes,
  withTenant,
  type NoteKind,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The store of the internal notes of a conversation (C6-2, N194) as app_role, through RLS: notes newest first a page at a time, trimmed
// and NFC, with the author's name; nothing of a conversation the session does not see.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const ids = { ws: '', ws2: '', conversation: '' };
let admin: pg.Client;
let pool: pg.Pool;
const inWs = <T>(workspaces: string[], fn: Parameters<typeof withTenant<T>>[2], org = A) =>
  withTenant(pool, { orgId: org, workspaceIds: workspaces }, fn);
const add = (body: string, kind: NoteKind = 'note', workspaces = [ids.ws]) =>
  inWs(workspaces, (tx) =>
    addConversationNote(tx, {
      id: uuidv7(),
      conversationId: ids.conversation,
      kind,
      authorUserId: seedUsers.get(A)!,
      body,
    }),
  );
const list = (q: { cursor?: string; limit: number }, workspaces = [ids.ws], org = A) =>
  inWs(workspaces, (tx) => listConversationNotes(tx, ids.conversation, q), org);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  const one = async (sql: string) =>
    (await admin.query<{ id: string }>(sql, [A])).rows[0]?.id as string;
  ids.ws = await one('SELECT id FROM workspaces WHERE org_id = $1');
  ids.conversation = await one('SELECT id FROM conversations WHERE org_id = $1');
  ids.ws2 = uuidv7();
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')`,
    [ids.ws2, A],
  );
  await admin.query("UPDATE users SET display_name = 'Lan' WHERE id = $1", [seedUsers.get(A)]);
  // The seed note of fixtures.ts is out of the way of these tests.
  await admin.query('DELETE FROM conversation_notes WHERE org_id = $1', [A]);
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('conversation-note-store', () => {
  it('writes notes trimmed and in NFC with their author, and reads them newest first a page at a time', async () => {
    const first = await add('  Khách hẹn gọi lại  ');
    const second = await add('Giao hàng chậm'.normalize('NFD'), 'transfer_reason');
    const third = await add('Đã báo kho');
    expect(first).toMatchObject({
      body: 'Khách hẹn gọi lại',
      kind: 'note',
      authorUserId: seedUsers.get(A),
      authorName: 'Lan',
    });
    expect(second).toMatchObject({ body: 'Giao hàng chậm', kind: 'transfer_reason' });
    const page = await list({ limit: 2 });
    expect(page.rows.map((r) => r.id)).toEqual([third.id, second.id]);
    const next = await list({ limit: 2, cursor: page.nextCursor! });
    expect([next.rows.map((r) => r.id), next.nextCursor]).toEqual([[first.id], null]);
  });

  it('refuses what the table refuses, and shows nothing of a conversation the session does not see', async () => {
    expect(await sqlState(add('x'.repeat(2001)))).toBe('23514');
    expect(await sqlState(add('y'.repeat(501), 'transfer_reason'))).toBe('23514');
    expect(await sqlState(add('Ngoài workspace', 'note', [ids.ws2]))).toBe('42501');
    expect((await list({ limit: 10 }, [ids.ws2])).rows).toEqual([]);
    expect((await list({ limit: 10 }, [ids.ws], B)).rows).toEqual([]);
    for (const limit of [0, 101]) await expect(list({ limit })).rejects.toThrow(RangeError);
  });
});
