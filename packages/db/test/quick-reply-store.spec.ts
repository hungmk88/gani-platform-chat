import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  countQuickReplyUse,
  createDbPool,
  createQuickReply,
  deleteQuickReply,
  listQuickReplies,
  lockQuickReply,
  QuickReplyShortcutTakenError,
  updateQuickReply,
  withTenant,
} from '../src/index.js';
import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The canned answers of a workspace (C7, N163) through RLS: one live template per shortcut in a workspace, most used first, nothing
// deleted, and nothing of another workspace or organisation.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;
let [ws, other, owner] = ['', '', ''];
const inWs = <T>(fn: Parameters<typeof withTenant<T>>[2], workspaces = [ws]) =>
  withTenant(pool, { orgId: A, workspaceIds: workspaces }, fn);
const make = (shortcut: string, body = 'Chào {{customer_name}}', tags: string[] = []) =>
  inWs((tx) =>
    createQuickReply(tx, { id: uuidv7(), workspaceId: ws, shortcut, body, tags, createdBy: owner }),
  );
const list = (q: { q?: string; tag?: string } = {}) =>
  inWs((tx) => listQuickReplies(tx, { workspaceId: ws, ...q }));

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  owner = seedUsers.get(A)!;
  ws = (await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [A]))
    .rows[0]!.id;
  other = uuidv7();
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws-qr', 'W2', 'service')`,
    [other, A],
  );
  // The seed template of fixtures.ts is out of the way of these tests.
  await admin.query('UPDATE quick_replies SET deleted_at = now() WHERE org_id = $1', [A]);
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('quick-reply-store', () => {
  it('makes templates, lists them most used first, by the start of a shortcut or by a tag', async () => {
    const [hello, price, ship] = [
      await make('chao', 'Chào {{customer_name}}', ['mo-dau']),
      await make('bao-gia', 'Gửi anh/chị báo giá', ['ban-si', 'gia']),
      await make('ban-giao', 'Giao trong ngày', ['ban-si']),
    ];
    expect(hello).toMatchObject({
      workspaceId: ws,
      shortcut: 'chao',
      tags: ['mo-dau'],
      useCount: 0,
    });
    expect(await inWs((tx) => countQuickReplyUse(tx, ship.id))).toBe(1);
    expect(await inWs((tx) => countQuickReplyUse(tx, ship.id))).toBe(2);
    expect(await inWs((tx) => countQuickReplyUse(tx, price.id))).toBe(1);
    expect((await list()).map((t) => t.shortcut)).toEqual(['ban-giao', 'bao-gia', 'chao']);
    expect((await list({ q: 'ba' })).map((t) => t.shortcut)).toEqual(['ban-giao', 'bao-gia']);
    expect((await list({ q: 'b%' })).map((t) => t.shortcut)).toEqual([]);
    expect((await list({ tag: 'ban-si' })).map((t) => t.shortcut)).toEqual(['ban-giao', 'bao-gia']);
  });

  it('keeps one live template per shortcut in a workspace, changes and ends one, and gives its shortcut back', async () => {
    const first = await make('cam-on');
    await expect(make('cam-on')).rejects.toBeInstanceOf(QuickReplyShortcutTakenError);
    const second = await make('cam-on-2');
    await expect(
      inWs((tx) => updateQuickReply(tx, second.id, { shortcut: 'cam-on' })),
    ).rejects.toBeInstanceOf(QuickReplyShortcutTakenError);
    const changed = await inWs(async (tx) => {
      await lockQuickReply(tx, first.id);
      return updateQuickReply(tx, first.id, { body: 'Cảm ơn {{customer_name}}', tags: ['cuoi'] });
    });
    expect(changed).toMatchObject({
      shortcut: 'cam-on',
      body: 'Cảm ơn {{customer_name}}',
      tags: ['cuoi'],
    });
    expect(+changed.updatedAt).toBeGreaterThanOrEqual(+first.updatedAt);
    await inWs((tx) => deleteQuickReply(tx, first.id));
    expect(await inWs((tx) => lockQuickReply(tx, first.id))).toBeNull();
    expect(await inWs((tx) => countQuickReplyUse(tx, first.id))).toBeNull();
    expect((await make('cam-on')).shortcut).toBe('cam-on');
  });

  it('shows nothing of another workspace or organisation, and the database refuses a bad shortcut, body or tag list', async () => {
    const mine = await make('rieng');
    expect(await inWs((tx) => lockQuickReply(tx, mine.id), [other])).toBeNull();
    expect(
      await withTenant(pool, { orgId: B, workspaceIds: [ws] }, (tx) => lockQuickReply(tx, mine.id)),
    ).toBeNull();
    // Same shortcut in another workspace of the organisation is free.
    const there = await inWs(
      (tx) =>
        createQuickReply(tx, {
          id: uuidv7(),
          workspaceId: other,
          shortcut: 'rieng',
          body: 'X',
          tags: [],
          createdBy: owner,
        }),
      [other],
    );
    expect(there.workspaceId).toBe(other);
    // A workspace outside the transaction's: refused by the policy (WITH CHECK), not written.
    expect(
      await sqlState(
        inWs((tx) =>
          createQuickReply(tx, {
            id: uuidv7(),
            workspaceId: other,
            shortcut: 'lan',
            body: 'X',
            tags: [],
            createdBy: owner,
          }),
        ),
      ),
    ).toBe('42501');
    for (const [shortcut, body, tags] of [
      ['Có Dấu', 'X', []],
      ['/chao', 'X', []],
      ['ok', '   ', []],
      ['ok2', 'x'.repeat(2001), []],
      ['ok3', 'X', Array.from({ length: 11 }, (_, i) => `t${i}`)],
    ] as const)
      expect(
        await sqlState(
          admin.query(
            `INSERT INTO quick_replies (id, org_id, workspace_id, shortcut, body, tags) VALUES ($1, $2, $3, $4, $5, $6)`,
            [uuidv7(), A, ws, shortcut, body, tags],
          ),
        ),
        shortcut,
      ).toBe('23514');
  });
});

// A session of A that holds the workspace of B too: only the org_id of quick_replies_app refuses a template for B. Without org_id in
// its WITH CHECK, A would write into B: the gap this case closes. In SQL of A's own, rolled back (asApp).
describe('quick_replies_app: A writes no template for B', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: url('app') });
    await app.connect();
  });
  afterAll(() => app.end());

  it('refuses a template for B, with the workspace of B in the session (42501, WITH CHECK)', async () => {
    const theirs = await admin.query<{ id: string }>(
      'SELECT id FROM workspaces WHERE org_id = $1',
      [B],
    );
    const wsB = theirs.rows[0]!.id;
    const sql = `INSERT INTO quick_replies (id, org_id, workspace_id, shortcut, body) VALUES ($1, $2, $3, 'chen', 'X')`;
    const insert = asApp(app, A, [ws, wsB], () => app.query(sql, [uuidv7(), B, wsB]));
    expect(await sqlState(insert)).toBe('42501');
  });
});
