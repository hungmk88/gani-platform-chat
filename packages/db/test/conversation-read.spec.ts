import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  InvalidCursorError,
  listConversations,
  listInboxChannels,
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

describe('the line of the Inbox (U30, N169)', () => {
  it('names the channel (a deleted one too), the holder (null name once they left) and the last message, in the list and alone', async () => {
    const [live, gone, left] = [uuidv7(), uuidv7(), uuidv7()];
    // prettier-ignore
    await admin.query(
      `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, app_id, oa_secret_key_enc, deleted_at)
       VALUES ($1, $3, $4, 'zalo_oa', 'u30-live', 'OA Live', 'app', decode(repeat('ab', 32), 'hex'), NULL),
              ($2, $3, $4, 'zalo_oa', 'u30-gone', 'OA Gone', 'app', decode(repeat('ab', 32), 'hex'), now())`,
      [live, gone, A, W1],
    );
    await admin.query(
      `INSERT INTO users (id, email, status, display_name) VALUES ($1, $2, 'active', ' Lan ')`,
      [left, `${left}@example.test`],
    );
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', 'active')`,
      [uuidv7(), A, left],
    );
    const [named, deleted, none, held] = [
      await conversation({ assigned: left }),
      await conversation({}),
      await conversation({}),
      await conversation({ assigned: me }),
    ];
    // prettier-ignore
    for (const [id, channel, kind, text] of [[named, live, 'text', 'Dạ em cần báo giá'], [deleted, gone, 'sticker', null], [held, null, null, null]] as const)
      await admin.query(
        `UPDATE conversations SET channel_account_id = $2, external_user_id = CASE WHEN $2::uuid IS NULL THEN NULL ELSE 'zu-' || $1 END,
           last_message_kind = $3, last_message_preview = $4 WHERE id = $1`,
        [id, channel, kind, text],
      );
    const read = (id: string) => inA([W1], (tx) => loadConversationView(tx, id));
    expect(await read(named)).toMatchObject({
      channel: { id: live, type: 'zalo_oa', displayName: 'OA Live' },
      assignee: { id: left, name: 'Lan' },
      lastMessagePreview: 'Dạ em cần báo giá',
    });
    expect(await read(deleted)).toMatchObject({
      channel: { id: gone, type: 'zalo_oa', displayName: 'OA Gone' },
      assignee: null,
      lastMessagePreview: '[Sticker]',
    });
    expect(await read(none)).toMatchObject({
      channel: null,
      assignee: null,
      lastMessagePreview: null,
    });
    // The seeded person has no name: the holder is still named by id.
    expect(await read(held)).toMatchObject({ assignee: { id: me, name: null } });
    await admin.query(
      `UPDATE org_members SET status = 'suspended' WHERE org_id = $1 AND user_id = $2`,
      [A, left],
    );
    expect(await read(named)).toMatchObject({ assignee: { id: left, name: null } });
    const page = await list({});
    expect(page.rows.find((r) => r.id === named)).toEqual(await read(named));
    await admin.query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [
      [named, deleted, none, held],
    ]);
    await admin.query('DELETE FROM channel_accounts WHERE id = ANY($1::uuid[])', [[live, gone]]);
    await admin.query('DELETE FROM org_members WHERE user_id = $1', [left]);
    await admin.query('DELETE FROM users WHERE id = $1', [left]);
  });
});

describe('the filters of the Inbox (U30): channel and customer', () => {
  // CH1 and CH2 in W1, CHW2 in W2, CHB in organisation B. one name holds a literal % and _; one
  // customer is deleted; c4 has no customer. Times interleave matching and other rows, so a filter applied after the page is cut loses rows.
  const [CH1, CH2, CHW2, CHB] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const [HOA, BINH, WILD, GONE] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const c: Record<'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'w2', string> = {} as never;
  const ids = async (q: Partial<ConversationListQuery>, workspaces = [W1]) =>
    new Set((await list(q, workspaces)).rows.map((r) => r.id));
  const set = (...keys: (keyof typeof c)[]) => new Set(keys.map((k) => c[k]));
  const pages = async (q: Partial<ConversationListQuery>) => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ ...q, limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return seen;
  };

  beforeAll(async () => {
    const { rows } = await admin.query<{ id: string }>(
      'SELECT id FROM workspaces WHERE org_id = $1 LIMIT 1',
      [B],
    );
    // prettier-ignore
    for (const [id, org, ws] of [[CH1, A, W1], [CH2, A, W1], [CHW2, A, W2], [CHB, B, rows[0]?.id]] as const)
      await admin.query(
        `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, app_id, oa_secret_key_enc)
         VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA', 'app', decode(repeat('ab', 32), 'hex'))`,
        [id, org, ws, `f-${id}`],
      );
    // prettier-ignore
    for (const [id, name, phone, email, gone] of [
      [HOA, 'Hoà Nguyễn', '+84912345678', 'an@x.vn', false],
      [BINH, 'Bình Trần', '+84987654321', 'binh@x.vn', false],
      [WILD, '100% Bé_Na', null, null, false],
      [GONE, 'Hoà Cũ', null, null, true],
    ] as const)
      await admin.query(
        `INSERT INTO customers (id, org_id, display_name, phone_e164, email, deleted_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END)`,
        [id, A, name, phone, email, gone],
      );
    // prettier-ignore
    for (const [key, ws, channel, customer, minutes] of [
      ['c1', W1, CH1, HOA, 10], ['c2', W1, CH1, BINH, 9], ['c3', W1, CH2, HOA, 8], ['c4', W1, CH1, null, 7],
      ['c5', W1, CH1, WILD, 6], ['c6', W1, CH1, GONE, 5], ['c7', W1, CH2, HOA, 4], ['w2', W2, CHW2, HOA, 3],
    ] as const) {
      c[key] = await conversation({ ws, last: new Date(Date.UTC(2031, 0, 1, 0, minutes)).toISOString() });
      await admin.query(
        `UPDATE conversations SET channel_account_id = $2, external_user_id = $4, customer_id = $3 WHERE id = $1`,
        [c[key], channel, customer, `zu-${c[key]}`],
      );
    }
  });

  afterAll(async () => {
    await admin.query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [Object.values(c)]);
    await admin.query('DELETE FROM customers WHERE id = ANY($1::uuid[])', [
      [HOA, BINH, WILD, GONE],
    ]);
    await admin.query('DELETE FROM channel_accounts WHERE id = ANY($1::uuid[])', [
      [CH1, CH2, CHW2, CHB],
    ]);
  });

  it('keeps one channel; an unknown one, one of another organisation or of a workspace not in the session match nothing', async () => {
    expect(await ids({ channelAccountId: CH1 })).toEqual(set('c1', 'c2', 'c4', 'c5', 'c6'));
    expect(await ids({ channelAccountId: uuidv7() })).toEqual(new Set());
    expect(await ids({ channelAccountId: CHB })).toEqual(new Set());
    expect(await ids({ channelAccountId: CHW2 })).toEqual(new Set());
    expect(await ids({ channelAccountId: CHW2 }, [W1, W2])).toEqual(set('w2'));
  });

  it('matches a part of the name, any case, % and _ literally; a deleted customer or none never matches', async () => {
    expect(await ids({ customer: { name: 'hoà' } })).toEqual(set('c1', 'c3', 'c7'));
    expect(await ids({ customer: { name: 'BÌNH' } })).toEqual(set('c2'));
    // Every stored name is NFC (202611010900); a search typed in NFD finds it too.
    expect(await ids({ customer: { name: 'Hoà'.normalize('NFD') } })).toEqual(
      set('c1', 'c3', 'c7'),
    );
    expect(await ids({ customer: { name: '%' } })).toEqual(set('c5'));
    expect(await ids({ customer: { name: '_' } })).toEqual(set('c5'));
    expect(await ids({ customer: { name: 'cũ' } })).toEqual(new Set());
  });

  it('matches the start of the phone and the whole email only', async () => {
    expect(await ids({ customer: { phonePrefix: '+84912' } })).toEqual(set('c1', 'c3', 'c7'));
    expect(await ids({ customer: { email: 'an@x.vn' } })).toEqual(set('c1', 'c3', 'c7'));
    expect(await ids({ customer: { email: 'an@x' } })).toEqual(new Set());
  });

  it('joins channel and customer with AND', async () => {
    expect(await ids({ channelAccountId: CH1, customer: { name: 'hoà' } })).toEqual(set('c1'));
    expect(await ids({ channelAccountId: CH1, customer: { name: 'zzz' } })).toEqual(new Set());
    expect(await ids({ channelAccountId: uuidv7(), customer: { name: 'hoà' } })).toEqual(new Set());
  });

  it('filters before the page is cut: page by page gives each match once, for the channel and for the customer', async () => {
    expect(await pages({ channelAccountId: CH1 })).toEqual([c.c1, c.c2, c.c4, c.c5, c.c6]);
    expect(await pages({ customer: { name: 'hoà' } })).toEqual([c.c1, c.c3, c.c7]);
  });
});

describe('listInboxChannels (U56)', () => {
  // CHM: the viewer's own (twice: listed once). CHC: only a colleague's. CHX: a colleague's and an unclaimed one. CHE: no conversation.
  // CHD: deleted, with an unclaimed one. CHW: in W2. CHB: organisation B.
  const [CHM, CHC, CHX, CHE, CHD, CHW, CHB] = Array.from({ length: 7 }, () => uuidv7()) as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const made: string[] = [];
  const scope = (workspaces: string[], s: Parameters<typeof listInboxChannels>[1] = {}) =>
    inA(workspaces, (tx) => listInboxChannels(tx, s));
  const ids = async (workspaces: string[], s: Parameters<typeof listInboxChannels>[1] = {}) =>
    (await scope(workspaces, s)).map((r) => r.id);

  beforeAll(async () => {
    const { rows } = await admin.query<{ id: string }>(
      'SELECT id FROM workspaces WHERE org_id = $1 LIMIT 1',
      [B],
    );
    const WB = rows[0]?.id as string;
    // prettier-ignore
    for (const [id, org, ws, name, gone] of [
      [CHM, A, W1, 'A mine', false], [CHC, A, W1, 'B colleague', false], [CHX, A, W1, 'C mixed', false],
      [CHE, A, W1, 'D empty', false], [CHD, A, W1, 'E deleted', true], [CHW, A, W2, 'F w2', false], [CHB, B, WB, 'G org B', false],
    ] as const)
      await admin.query(
        `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, app_id, oa_secret_key_enc, deleted_at)
         VALUES ($1, $2, $3, 'zalo_oa', $4, $5, 'app', decode(repeat('ab', 32), 'hex'), CASE WHEN $6 THEN now() END)`,
        [id, org, ws, `f-${id}`, name, gone],
      );
    // prettier-ignore
    for (const [channel, ws, assigned, org] of [
      [CHM, W1, me, A], [CHM, W1, me, A], [CHC, W1, other, A], [CHX, W1, other, A], [CHX, W1, undefined, A],
      [CHD, W1, undefined, A], [CHW, W2, undefined, A], [CHB, WB, undefined, B],
    ] as const) {
      const id = await conversation({ ws, ...(assigned ? { assigned } : {}) }, org);
      made.push(id);
      await admin.query(`UPDATE conversations SET channel_account_id = $2, external_user_id = $3 WHERE id = $1`, [id, channel, `zu-${id}`]);
    }
  });

  afterAll(async () => {
    await admin.query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [made]);
    await admin.query('DELETE FROM channel_accounts WHERE id = ANY($1::uuid[])', [
      [CHM, CHC, CHX, CHE, CHD, CHW, CHB],
    ]);
  });

  it('offers the live channels of the conversations in scope, once each, by name; never one with none, deleted, or RLS hides', async () => {
    expect(await scope([W1])).toEqual([
      { id: CHM, type: 'zalo_oa', displayName: 'A mine', status: 'disconnected' },
      { id: CHC, type: 'zalo_oa', displayName: 'B colleague', status: 'disconnected' },
      { id: CHX, type: 'zalo_oa', displayName: 'C mixed', status: 'disconnected' },
    ]);
    expect(await ids([W1, W2])).toEqual([CHM, CHC, CHX, CHW]);
    expect(await ids([W1, W2], { workspaceId: W2 })).toEqual([CHW]);
  });

  it('keeps sales and support to their own and the unclaimed: a channel of a colleague only is not offered', async () => {
    expect(await ids([W1], { mineOrUnassigned: me })).toEqual([CHM, CHX]);
    expect(await ids([W1], { mineOrUnassigned: other })).toEqual([CHC, CHX]);
  });

  it('offers no channel that filters the list to nothing, for every scope', async () => {
    for (const [workspaces, s] of [
      [[W1], {}],
      [[W1, W2], {}],
      [[W1], { mineOrUnassigned: me }],
      [[W1], { mineOrUnassigned: other }],
    ] as const)
      for (const channelAccountId of await ids([...workspaces], s))
        expect(
          (await list({ ...s, channelAccountId }, [...workspaces])).rows.length,
          channelAccountId,
        ).toBeGreaterThan(0);
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
