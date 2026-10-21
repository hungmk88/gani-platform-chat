import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  InvalidCursorError,
  listConversations,
  listMessages,
  listMessagesAfter,
  loadMessageView,
  loadConversationView,
  withTenant,
  type ConversationListQuery,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The read model of the Inbox (conversation-read.ts): order and keyset pages, filters, the scope of a role, RLS, messages newest first.
// Org A gets a workspace of its own for this file (W1, W2), so what other files leave in the seeded workspace never shows here.
const [A, B, W1, W2] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const users = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;
let [me, other] = ['', ''];

const inA = <T>(workspaces: string[], fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: A, workspaceIds: workspaces }, fn);
const list = (q: Partial<ConversationListQuery> & { limit?: number }, workspaces = [W1]) =>
  inA(workspaces, (tx) => listConversations(tx, { limit: 50, ...q }));

type Row = {
  ws?: string;
  state?: string;
  assigned?: string;
  hold?: boolean;
  last?: string | null;
  created?: string;
};
// prettier-ignore
async function conversation(o: Row = {}, org = A): Promise<string> {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state, assigned_user_id, after_hours_hold, last_message_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, coalesce($8::timestamptz, now()))`,
    [id, org, o.ws ?? W1, o.state ?? (o.assigned ? 'HUMAN_ACTIVE' : 'BOT_ACTIVE'), o.assigned ?? null, o.hold ?? false, o.last ?? null, o.created ?? null],
  );
  return id;
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  me = users.get(A) as string;
  other = uuidv7();
  await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
    other,
    `${other}@example.test`,
  ]);
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', 'active')`,
    [uuidv7(), A, other],
  );
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $3, 'w1', 'W1', 'service'), ($2, $3, 'w2', 'W2', 'service')`,
    [W1, W2, A],
  );
});

afterAll(async () => {
  await pool.end();
  await admin.query('DELETE FROM messages WHERE org_id = $1', [A]).catch(() => undefined);
  await admin
    .query('DELETE FROM conversations WHERE workspace_id = ANY($1::uuid[])', [[W1, W2]])
    .catch(() => undefined);
  await admin
    .query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [[W1, W2]])
    .catch(() => undefined);
  await admin.query('DELETE FROM org_members WHERE user_id = $1', [other]).catch(() => undefined);
  await admin.query('DELETE FROM users WHERE id = $1', [other]).catch(() => undefined);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('listConversations', () => {
  it('orders by the last activity (creation when there is no message), id breaking ties, and pages without a gap or a repeat', async () => {
    const at = '2026-10-01T10:00:00.123456Z';
    const [tieLow, tieHigh] = [uuidv7(), uuidv7()].sort();
    for (const id of [tieLow, tieHigh] as string[])
      await admin.query(
        `INSERT INTO conversations (id, org_id, workspace_id, state, last_message_at) VALUES ($1, $2, $3, 'BOT_ACTIVE', $4)`,
        [id, A, W2, at],
      );
    const newest = await conversation({ ws: W2, last: '2026-10-03T00:00:00Z' });
    const noMessage = await conversation({ ws: W2, last: null, created: '2026-10-02T00:00:00Z' });
    const oldest = await conversation({ ws: W2, last: '2026-09-01T00:00:00Z' });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await list({ limit: 3, ...(cursor ? { cursor } : {}) }, [W2]);
      seen.push(...result.rows.map((r) => r.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toEqual([newest, noMessage, tieHigh, tieLow, oldest]);
  });

  it('filters by workspace, state, hold, assignee, and the scope of mine or unassigned', async () => {
    const [mine, theirs, free, held, elsewhere] = [
      await conversation({ assigned: me }),
      await conversation({ assigned: other }),
      await conversation({ state: 'HUMAN_WAITING_Q' }),
      await conversation({ hold: true }),
      await conversation({ ws: W2, state: 'HUMAN_WAITING_Q' }),
    ];
    const ids = async (q: Partial<ConversationListQuery>, ws = [W1]) =>
      (await list(q, ws)).rows.map((r) => r.id).sort();
    expect(await ids({ assigned: { userId: me } })).toEqual([mine]);
    expect(await ids({ mineOrUnassigned: me })).not.toContain(theirs);
    expect(await ids({ mineOrUnassigned: me })).toEqual(expect.arrayContaining([mine, free, held]));
    expect(await ids({ states: ['HUMAN_WAITING_Q'] }, [W1, W2])).toEqual(
      expect.arrayContaining([free, elsewhere].sort()),
    );
    expect(await ids({ states: ['HUMAN_WAITING_Q'], workspaceId: W2 }, [W1, W2])).toEqual([
      elsewhere,
    ]);
    expect(await ids({ afterHoursHold: true })).toEqual([held]);
    expect((await ids({ assigned: 'none' })).includes(mine)).toBe(false);
  });

  it('sees only the workspaces of the session and never another organisation (RLS)', async () => {
    const hidden = await conversation({ ws: W2 });
    const stranger = await conversation({}, B).catch(() => null);
    const visible = (await list({}, [W1])).rows.map((r) => r.id);
    expect(visible).not.toContain(hidden);
    if (stranger) expect(visible).not.toContain(stranger);
    expect(await inA([W1], (tx) => loadConversationView(tx, hidden))).toBeNull();
    expect(await inA([W2], (tx) => loadConversationView(tx, hidden))).toMatchObject({
      id: hidden,
      workspaceId: W2,
    });
  });

  it('refuses a cursor it did not give and a limit outside 1..100', async () => {
    for (const cursor of [
      'x',
      'not base64!',
      Buffer.from('{"v":2}').toString('base64url'),
      Buffer.from('{"v":1,"at":"x","id":"y"}').toString('base64url'),
    ])
      await expect(list({ cursor })).rejects.toBeInstanceOf(InvalidCursorError);
    await expect(list({ limit: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(list({ limit: 101 })).rejects.toBeInstanceOf(RangeError);
  });
});

describe('listMessages', () => {
  it('gives the messages of one conversation, newest first, page by page', async () => {
    const [c, d] = [await conversation(), await conversation()];
    for (let n = 1; n <= 5; n++)
      await admin.query(
        `INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, body) VALUES ($1, $2, $3, $4, $5, 'customer', 'text', 'm')`,
        [uuidv7(), A, W1, n === 3 ? d : c, n],
      );
    const pages: number[][] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await inA([W1], (tx) =>
        listMessages(tx, c, { limit: 2, ...(cursor ? { cursor } : {}) }),
      );
      pages.push(result.rows.map((r) => r.sequenceNumber));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(pages).toEqual([
      [5, 4],
      [2, 1],
    ]);
    expect(await inA([W2], (tx) => listMessages(tx, c, { limit: 10 }))).toEqual({
      rows: [],
      nextCursor: null,
    });
  });
});

describe('listMessagesAfter', () => {
  it('gives the messages after a number, oldest first, page by page, with the highest number of the conversation', async () => {
    const [c, empty] = [await conversation(), await conversation()];
    for (let n = 1; n <= 7; n++)
      await admin.query(
        `INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, body) VALUES ($1, $2, $3, $4, $5, 'customer', 'text', 'm')`,
        [uuidv7(), A, W1, c, n],
      );
    const after = (n: number, limit = 3) =>
      inA([W1], (tx) => listMessagesAfter(tx, c, { after: n, limit }));
    const first = await after(2);
    expect(first.rows.map((r) => r.sequenceNumber)).toEqual([3, 4, 5]);
    expect(first).toMatchObject({ hasMore: true, maxSequence: 7 });
    expect((await after(5)).rows.map((r) => r.sequenceNumber)).toEqual([6, 7]);
    expect(await after(5)).toMatchObject({ hasMore: false, maxSequence: 7 });
    expect(await after(9)).toEqual({ rows: [], hasMore: false, maxSequence: 7 });
    expect(await inA([W1], (tx) => listMessagesAfter(tx, empty, { after: 0, limit: 5 }))).toEqual({
      rows: [],
      hasMore: false,
      maxSequence: 0,
    });
    // Another workspace of the session sees nothing of it, not even its highest number (RLS).
    expect(await inA([W2], (tx) => listMessagesAfter(tx, c, { after: 0, limit: 5 }))).toEqual({
      rows: [],
      hasMore: false,
      maxSequence: 0,
    });
  });

  it('refuses a number below 0, a limit outside 1..200 and an id that is not a UUID', async () => {
    const c = await conversation();
    for (const q of [
      { after: -1, limit: 1 },
      { after: 0, limit: 0 },
      { after: 0, limit: 201 },
      { after: 0.5, limit: 1 },
    ])
      await expect(inA([W1], (tx) => listMessagesAfter(tx, c, q))).rejects.toThrow(RangeError);
    await expect(
      inA([W1], (tx) => listMessagesAfter(tx, 'x', { after: 0, limit: 1 })),
    ).rejects.toThrow();
  });
});

describe('loadMessageView', () => {
  it('gives one message with its conversation, and null for an unknown id or another workspace (RLS)', async () => {
    const c = await conversation();
    const id = uuidv7();
    await admin.query(
      `INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, body) VALUES ($1, $2, $3, $4, 1, 'customer', 'text', 'xin chào')`,
      [id, A, W1, c],
    );
    expect(await inA([W1], (tx) => loadMessageView(tx, id))).toMatchObject({
      id,
      conversationId: c,
      sequenceNumber: 1,
      senderKind: 'customer',
      kind: 'text',
      body: 'xin chào',
    });
    expect(await inA([W1], (tx) => loadMessageView(tx, uuidv7()))).toBeNull();
    expect(await inA([W2], (tx) => loadMessageView(tx, id))).toBeNull();
    await expect(inA([W1], (tx) => loadMessageView(tx, 'x'))).rejects.toThrow();
  });
});
