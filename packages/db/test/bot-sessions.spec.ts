import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// bot_sessions and bot_session_steps (D1b1a, N183, Brief P13 and M05): a session is seen only by who sees its conversation (A,
// 01/11/2026), one active session per conversation, a step belongs to its session's conversation, the payload of a step holds an edge's
// label and a variable's name only (rule 5), and app_role deletes nothing. Rows are written as migration_role unless the case is RLS.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const workspaceOf = new Map<string, string>();
let [hidden, versionA] = ['', ''];
let admin: pg.Client;
let app: pg.Client;

const q = (text: string, params: unknown[] = []) => admin.query(text, params);
async function conversation(org: string, workspace = workspaceOf.get(org)) {
  const id = uuidv7();
  await q(
    `INSERT INTO conversations (id, org_id, workspace_id, state) VALUES ($1, $2, $3, 'BOT_ACTIVE')`,
    [id, org, workspace],
  );
  return id;
}
const SESSION = `INSERT INTO bot_sessions (id, org_id, conversation_id, version_id, status, ended_at, vars, recent_steps)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
async function session(org: string, conv: string, status = 'active') {
  const id = uuidv7();
  await q(SESSION, [
    id,
    org,
    conv,
    versionA,
    status,
    status === 'active' ? null : new Date(),
    {},
    '[]',
  ]);
  return id;
}
const STEP = `INSERT INTO bot_session_steps (id, org_id, session_id, conversation_id, step_index, node_key, node_type, payload)
  VALUES ($1, $2, $3, $4, $5, 'ask', 'question', $6)`;
const inA = <T>(fn: () => Promise<T>) => asApp(app, A, [workspaceOf.get(A) ?? ''], fn);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const org of [A, B]) {
    seedUsers.set(org, await seedTenant(admin, org));
    const { rows } = await q('SELECT id FROM workspaces WHERE org_id = $1', [org]);
    workspaceOf.set(org, (rows[0] as { id: string }).id);
  }
  hidden = uuidv7();
  await q(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')`,
    [hidden, A],
  );
  const { rows } = await q('SELECT id FROM bot_flow_versions WHERE org_id = $1', [A]);
  versionA = (rows[0] as { id: string }).id;
});

afterAll(async () => {
  await app.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('bot_sessions and bot_session_steps', () => {
  it('show a session and its steps only to who sees the conversation, in its own organisation', async () => {
    const [mine, other] = [await conversation(A), await conversation(A, hidden)];
    const [seen, unseen] = [await session(A, mine), await session(A, other)];
    await q(STEP, [uuidv7(), A, unseen, other, 1, {}]);
    const rows = await inA(async () => ({
      sessions: (
        await app.query<{ id: string; org_id: string }>('SELECT id, org_id FROM bot_sessions')
      ).rows,
      steps: (
        await app.query<{ conversation_id: string }>(
          'SELECT conversation_id FROM bot_session_steps',
        )
      ).rows,
    }));
    expect(rows.sessions.map((s) => s.id)).toContain(seen);
    expect(rows.sessions.map((s) => s.id)).not.toContain(unseen);
    expect(rows.sessions.every((s) => s.org_id === A)).toBe(true);
    expect(rows.steps.map((s) => s.conversation_id)).not.toContain(other);
    // Writing for a conversation one cannot see, or for another organisation: refused by the policy.
    const insert = (org: string, conv: string) =>
      sqlState(
        inA(() =>
          app.query(SESSION, [uuidv7(), org, conv, versionA, 'completed', new Date(), {}, '[]']),
        ),
      );
    expect(await insert(A, other)).toBe('42501');
    expect(await insert(B, other)).toBe('42501');
    expect(await sqlState(inA(() => app.query(STEP, [uuidv7(), A, unseen, other, 2, {}])))).toBe(
      '42501',
    );
  });

  it('hold one active session per conversation, with ended_at exactly when it ended', async () => {
    const conv = await conversation(A);
    await session(A, conv, 'completed');
    await session(A, conv, 'handed_off');
    await session(A, conv);
    expect(await sqlState(session(A, conv))).toBe('23505');
    const bad = (status: string, ended: Date | null) =>
      sqlState(q(SESSION, [uuidv7(), A, conv, versionA, status, ended, {}, '[]']));
    expect(await bad('completed', null)).toBe('23514');
    expect(await bad('abandoned', null)).toBe('23514');
    expect(await bad('paused', new Date())).toBe('23514');
    const shape = (vars: unknown, recent: string) =>
      sqlState(q(SESSION, [uuidv7(), A, conv, versionA, 'completed', new Date(), vars, recent]));
    expect(await shape('[]', '[]')).toBe('23514');
    expect(await shape({}, JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ i }))))).toBe(
      '23514',
    );
    expect(
      await shape({}, JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ i })))),
    ).toBeUndefined();
  });

  it('keep a step to its session’s conversation, and its payload to an edge label and a variable name', async () => {
    const [conv, elsewhere] = [await conversation(A), await conversation(A)];
    const id = await session(A, conv);
    const step = (payload: unknown, on = conv) =>
      sqlState(q(STEP, [uuidv7(), A, id, on, 1, payload]));
    expect(await step({ edge_label: 'Có', variable: 'phone' })).toBeUndefined();
    expect(await step({}, elsewhere)).toBe('23503');
    for (const payload of [
      { text: 'Gọi 0912345678' },
      { variable: 'phone', value: '0912345678' },
      { variable: 'Số ĐT' },
      { edge_label: 'x'.repeat(101) },
      { edge_label: 1 },
      '[]',
    ])
      expect(await step(payload)).toBe('23514');
  });

  it('give app_role no DELETE and no way to move a session or a step', async () => {
    const conv = await conversation(A);
    const id = await session(A, conv);
    for (const sql of [
      'DELETE FROM bot_sessions WHERE id = $1',
      'DELETE FROM bot_session_steps WHERE session_id = $1',
      `UPDATE bot_sessions SET conversation_id = conversation_id WHERE id = $1`,
      `UPDATE bot_session_steps SET payload = '{}' WHERE session_id = $1`,
    ])
      expect(await sqlState(inA(() => app.query(sql, [id])))).toBe('42501');
    // What a run changes, it may change.
    const advance = `UPDATE bot_sessions SET current_node_key = 'ask', step_count = 1, version = version + 1 WHERE id = $1`;
    expect(await sqlState(inA(() => app.query(advance, [id])))).toBeUndefined();
  });
});
