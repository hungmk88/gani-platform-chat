import { uuidv7 } from '@gani/domain';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyTransition,
  createDbPool,
  insertConversation,
  insertConversationEvent,
  loadConversation,
  withTenant,
  type NewConversationEvent,
  type TenantContext,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// M1.2 PR2c-1: the four functions of the conversation store against PostgreSQL. Org A has workspaces WA and WB; org B is a stranger.
const [A, B] = [uuidv7(), uuidv7()];
const WB = uuidv7();
let CB = '';
const users = new Map<string, string>();
let WA = '';
let admin: pg.Client;
let pool: pg.Pool;

const inA = (...workspaceIds: string[]): TenantContext => ({ orgId: A, workspaceIds });
// prettier-ignore
const BOT = { state: 'BOT_ACTIVE', afterHoursHold: false, assignedUserId: null, closedAt: null, outcome: null };
const QUEUE = { ...BOT, state: 'HUMAN_WAITING_Q' };
// prettier-ignore
const event = (conversationId: string, over: Partial<NewConversationEvent> = {}): NewConversationEvent => ({
  id: uuidv7(), conversationId, eventType: 'state_changed', fromState: 'BOT_ACTIVE', toState: 'HUMAN_WAITING_Q', fromHold: false,
  toHold: false, actorKind: 'system', actorId: null, versionAfter: 1, outcome: null, traceId: 't', detail: { transition: 'T02' }, ...over,
});
const fresh = async (workspace = WA) => {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state) VALUES ($1, $2, $3, 'BOT_ACTIVE')`,
    [id, A, workspace],
  );
  return id;
};
const stored = async (id: string) =>
  (
    await admin.query<{ state: string; version: number }>(
      'SELECT state, version FROM conversations WHERE id = $1',
      [id],
    )
  ).rows[0];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 4 });
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  const ws = await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [A]);
  WA = ws.rows[0]?.id as string;
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws-b', 'WB', 'service')`,
    [WB, A],
  );
  CB = await fresh(WB);
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('insertConversation and loadConversation', () => {
  it('inserts in the organisation of the context, at version 0, and reads it back', async () => {
    const id = uuidv7();
    const row = await withTenant(pool, inA(WA), async (tx) => {
      await insertConversation(tx, { id, workspaceId: WA, ...BOT });
      return loadConversation(tx, id);
    });
    expect(row).toMatchObject({
      id,
      orgId: A,
      workspaceId: WA,
      state: 'BOT_ACTIVE',
      version: 0,
      assignedUserId: null,
      afterHoursHold: false,
    });
  });

  it('refuses a workspace the context does not hold (42501)', async () => {
    const insert = withTenant(pool, inA(WA), (tx) =>
      insertConversation(tx, { id: uuidv7(), workspaceId: WB, ...BOT }),
    );
    expect(await sqlState(insert)).toBe('42501');
  });

  it('finds nothing in another workspace, in another organisation, or for an unknown id', async () => {
    const [first] = (
      await admin.query<{ id: string }>(
        'SELECT id FROM conversations WHERE workspace_id = $1 LIMIT 1',
        [WA],
      )
    ).rows;
    const seen = (ctx: TenantContext, id: string) =>
      withTenant(pool, ctx, (tx) => loadConversation(tx, id));
    expect(await seen(inA(WA), first?.id as string)).not.toBeNull();
    expect(await seen(inA(WA), CB)).toBeNull();
    expect(await seen({ orgId: B, workspaceIds: [WA] }, first?.id as string)).toBeNull();
    expect(await seen(inA(WA), uuidv7())).toBeNull();
  });
});

describe('applyTransition', () => {
  const write = (id: string, over: object = {}) => ({
    id,
    from: { state: 'BOT_ACTIVE', afterHoursHold: false },
    next: QUEUE,
    ...over,
  });

  it('changes the row, raises the version by one and commits with the caller', async () => {
    const id = await fresh();
    const row = await withTenant(pool, inA(WA), (tx) => applyTransition(tx, write(id)));
    expect(row).toMatchObject({ id, state: 'HUMAN_WAITING_Q', version: 1 });
    expect(await stored(id)).toEqual({ state: 'HUMAN_WAITING_Q', version: 1 });
  });

  it('returns null and leaves the row alone when the state, the flag or the version is not the one expected', async () => {
    const id = await fresh();
    const attempt = (over: object) =>
      withTenant(pool, inA(WA), (tx) => applyTransition(tx, write(id, over)));
    expect(await attempt({ from: { state: 'HUMAN_WAITING_Q', afterHoursHold: false } })).toBeNull();
    expect(await attempt({ from: { state: 'BOT_ACTIVE', afterHoursHold: true } })).toBeNull();
    expect(await attempt({ expectedVersion: 7 })).toBeNull();
    expect(await stored(id)).toEqual({ state: 'BOT_ACTIVE', version: 0 });
    expect(await attempt({ expectedVersion: 0 })).not.toBeNull();
  });

  it('returns null for a conversation the context cannot see', async () => {
    const other = await withTenant(pool, inA(WA), (tx) => applyTransition(tx, write(CB)));
    expect(other).toBeNull();
    expect(await stored(CB)).toEqual({ state: 'BOT_ACTIVE', version: 0 });
  });

  it('switches app.fsm off again: a direct UPDATE after it in the same transaction is refused (FS001)', async () => {
    const id = await fresh();
    const run = withTenant(pool, inA(WA), async (tx) => {
      await applyTransition(tx, write(id));
      await tx.execute(
        sql`UPDATE conversations SET state = 'BOT_ACTIVE', version = version + 1 WHERE id = ${id}`,
      );
    });
    expect(await sqlState(run)).toBe('FS001');
  });

  it('leaves the invariants to the database: a state without its assignee is refused (23514)', async () => {
    const id = await fresh();
    const run = withTenant(pool, inA(WA), (tx) =>
      applyTransition(tx, write(id, { next: { ...BOT, state: 'HUMAN_ACTIVE' } })),
    );
    expect(await sqlState(run)).toBe('23514');
  });
});

describe('insertConversationEvent', () => {
  it('appends a row in the organisation of the context', async () => {
    const id = await fresh();
    const ev = event(id);
    await withTenant(pool, inA(WA), (tx) => insertConversationEvent(tx, ev));
    const { rows } = await admin.query<{ org_id: string; event_type: string; detail: object }>(
      'SELECT org_id, event_type, detail FROM conversation_events WHERE id = $1',
      [ev.id],
    );
    expect(rows).toEqual([
      { org_id: A, event_type: 'state_changed', detail: { transition: 'T02' } },
    ]);
  });

  it('refuses an event for a conversation the context cannot see (42501, F7) and a bad event type (23514)', async () => {
    const id = await fresh();
    const hidden = withTenant(pool, inA(WA), (tx) => insertConversationEvent(tx, event(CB)));
    expect(await sqlState(hidden)).toBe('42501');
    const bad = withTenant(pool, inA(WA), (tx) =>
      insertConversationEvent(tx, event(id, { eventType: 'deleted' })),
    );
    expect(await sqlState(bad)).toBe('23514');
  });
});
