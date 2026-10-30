import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// `conversation_events` (M1.2 PR1, F7): the table is O (no workspace_id), yet an event is seen and written only by whoever sees its
// conversation, because the policies ask app.conversation_visible. Org A: workspaces WA and WB, one conversation and one event each.
const [A, B] = [uuidv7(), uuidv7()];
const [WB, CB, EA, EB] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const users = new Map<string, string>();
let WA = '';
let CA = '';
let admin: pg.Client;
let app: pg.Client;

const insertSql = `INSERT INTO conversation_events (id, org_id, conversation_id, event_type, to_state, actor_kind, version_after, trace_id)
  VALUES ($1, $2, $3, $4, $5, $6, 1, 't')`;
const event = (
  conversation: string,
  over: { type?: string; state?: string; actor?: string } = {},
) => [
  uuidv7(),
  A,
  conversation,
  over.type ?? 'state_changed',
  over.state ?? 'HUMAN_WAITING_Q',
  over.actor ?? 'system',
];
const ids = async () =>
  (await app.query<{ id: string }>('SELECT id FROM conversation_events')).rows.map((r) => r.id);

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
  await admin.query(insertSql, [EA, ...event(CA).slice(1)]);
  await admin.query(insertSql, [EB, ...event(CB).slice(1)]);
});

afterAll(async () => {
  await app.end();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('F7: events follow the visibility of their conversation', () => {
  it('with {WA} shows the events of WA and never those of WB (same org)', async () => {
    const seen = await asApp(app, A, [WA], ids);
    expect(seen).toContain(EA);
    expect(seen).not.toContain(EB);
  });

  it('with both workspaces both are visible; with {} nothing is; another org sees none', async () => {
    expect(await asApp(app, A, [WA, WB], ids)).toEqual(expect.arrayContaining([EA, EB]));
    expect(await asApp(app, A, [], ids)).toEqual([]);
    expect(await asApp(app, B, [WA, WB], ids)).not.toContain(EA);
  });

  it('with an org and no workspaces it raises TN001, not 0 rows', async () => {
    expect(await sqlState(asApp(app, A, null, ids))).toBe('TN001');
  });

  it('with {WA} an INSERT for a conversation of WA works and one for WB is refused (42501)', async () => {
    const insert = (c: string) => () => app.query(insertSql, event(c));
    expect(await sqlState(asApp(app, A, [WA], insert(CA)))).toBe(undefined);
    expect(await sqlState(asApp(app, A, [WA], insert(CB)))).toBe('42501');
  });

  // A session of A that holds a workspace of B too. Without WITH CHECK, A would write into a conversation of B: the FK only asks that
  // (org_id, conversation_id) exists. Without only its org_id, conversation_visible still refuses (it reads conversations under their
  // RLS, org A); that mutant changes no behaviour, and the structure check of rls-all-tables.spec.ts catches it.
  it('refuses an event of A for a conversation of B, with the workspace of B in the session (42501)', async () => {
    const theirs = await admin.query<{ w: string; c: string }>(
      'SELECT workspace_id AS w, id AS c FROM conversations WHERE org_id = $1',
      [B],
    );
    const [w, c] = [theirs.rows[0]?.w as string, theirs.rows[0]?.c as string];
    const insert = () =>
      app.query(insertSql, [uuidv7(), B, c, 'state_changed', 'HUMAN_WAITING_Q', 'system']);
    expect(await sqlState(asApp(app, A, [WA, w], insert))).toBe('42501');
  });

  it('is append-only for app_role: UPDATE and DELETE are refused (42501)', async () => {
    const update = () => app.query("UPDATE conversation_events SET detail = '{}'");
    expect(await sqlState(asApp(app, A, [WA], update))).toBe('42501');
    expect(
      await sqlState(asApp(app, A, [WA], () => app.query('DELETE FROM conversation_events'))),
    ).toBe('42501');
  });
});

describe('app.conversation_visible', () => {
  const visible = (c: string) => () =>
    app.query<{ v: boolean }>('SELECT app.conversation_visible($1, $2) AS v', [A, c]);

  it('is true for a conversation of the session, false for another workspace and for an unknown id', async () => {
    const answer = async (c: string) => (await asApp(app, A, [WA], visible(c))).rows[0]?.v;
    expect([await answer(CA), await answer(CB), await answer(uuidv7())]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('runs as its caller (not SECURITY DEFINER) and only app_role and support_role may execute it', async () => {
    const { rows } = await admin.query<{ definer: boolean; role: string; ok: boolean }>(
      `SELECT p.prosecdef AS definer, r AS role,
              has_function_privilege(r, 'app.conversation_visible(uuid, uuid)', 'EXECUTE') AS ok
       FROM pg_proc p, unnest(ARRAY['app_role', 'support_role', 'auth_role', 'public']) AS r
       WHERE p.proname = 'conversation_visible'`,
    );
    expect(rows.every((r) => !r.definer)).toBe(true);
    expect(rows.filter((r) => r.ok).map((r) => r.role)).toEqual(['app_role', 'support_role']);
  });
});

describe('F7 on the partitions (the policy is copied as text)', () => {
  it('9d: a mistaken GRANT on a partition still shows only the events of the visible conversations', async () => {
    const found = await admin.query<{ t: string }>(
      'SELECT tableoid::regclass::text AS t FROM conversation_events WHERE id = $1',
      [EA],
    );
    const child = app.escapeIdentifier(found.rows[0]?.t as string);
    try {
      await admin.query(`GRANT SELECT ON ${child} TO app_role`);
      expect(await sqlState(asApp(app, A, null, () => app.query(`SELECT 1 FROM ${child}`)))).toBe(
        'TN001',
      );
      const seen = await asApp(app, A, [WA], async () =>
        (await app.query<{ id: string }>(`SELECT id FROM ${child}`)).rows.map((r) => r.id),
      );
      expect(seen).toContain(EA);
      expect(seen).not.toContain(EB);
    } finally {
      await admin.query(`REVOKE ALL ON ${child} FROM app_role`).catch(() => undefined);
    }
  });
});

describe('the columns of conversation_events', () => {
  it.each([
    ['event_type', { type: 'deleted' }],
    ['to_state', { state: 'bot_active' }],
    ['actor_kind', { actor: 'robot' }],
  ])('refuses a bad %s (23514)', async (_name, over) => {
    expect(await sqlState(admin.query(insertSql, event(CA, over)))).toBe('23514');
  });

  it('refuses a blank trace_id and a detail that is not an object (23514)', async () => {
    const sql = `INSERT INTO conversation_events (id, org_id, conversation_id, event_type, actor_kind, version_after, trace_id, detail)
      VALUES ($1, $2, $3, 'created', 'system', 0, $4, $5::jsonb)`;
    expect(await sqlState(admin.query(sql, [uuidv7(), A, CA, ' ', '{}']))).toBe('23514');
    expect(await sqlState(admin.query(sql, [uuidv7(), A, CA, 't', '[]']))).toBe('23514');
  });

  it('refuses an event for a conversation of another organisation (23503)', async () => {
    expect(
      await sqlState(admin.query(insertSql, [uuidv7(), B, CA, 'created', null, 'system'])),
    ).toBe('23503');
  });
});
