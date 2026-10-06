import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// M1.2 PR2a (N96): the columns the ConversationStateMachine owns, the invariants of their values, and the trigger that lets nobody
// else change them. Org A has one workspace WA and one member; org B only supplies a person who is not a member of A.
const [A, B] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
let WA = '';
let admin: pg.Client;
let app: pg.Client;

type Over = {
  state?: string;
  assigned?: string | null;
  hold?: boolean;
  closedAt?: Date | null;
  outcome?: string | null;
};
const insertSql = `INSERT INTO conversations (id, org_id, workspace_id, state, assigned_user_id, after_hours_hold, closed_at, outcome)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
const put = (over: Over = {}, id = uuidv7()) =>
  admin.query(insertSql, [
    id,
    A,
    WA,
    over.state ?? 'BOT_ACTIVE',
    over.assigned ?? null,
    over.hold ?? false,
    over.closedAt ?? null,
    over.outcome ?? null,
  ]);
const NOW = new Date();

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  const ws = await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [A]);
  WA = ws.rows[0]?.id as string;
});

afterAll(async () => {
  await app.end();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('the invariants of the state machine columns (spec §3)', () => {
  const member = (): string => users.get(A) as string;

  it('accepts every combination the state machine can produce', async () => {
    const ok: Over[] = [
      { state: 'BOT_ACTIVE', hold: true },
      { state: 'HUMAN_WAITING_Q' },
      { state: 'HUMAN_ACTIVE', assigned: member() },
      { state: 'PENDING_CUSTOMER', assigned: member() },
      ...['won', 'lost', 'resolved', 'resolved_by_bot'].map((outcome) => ({
        state: 'CLOSED',
        closedAt: NOW,
        outcome,
      })),
    ];
    for (const over of ok) expect(await sqlState(put(over)), JSON.stringify(over)).toBe(undefined);
  });

  it.each<[string, () => Over]>([
    ['a hold outside BOT_ACTIVE', () => ({ state: 'HUMAN_WAITING_Q', hold: true })],
    [
      'a hold on a closed conversation',
      () => ({ state: 'CLOSED', closedAt: NOW, outcome: 'won', hold: true }),
    ],
    ['HUMAN_ACTIVE with nobody assigned', () => ({ state: 'HUMAN_ACTIVE' })],
    ['PENDING_CUSTOMER with nobody assigned', () => ({ state: 'PENDING_CUSTOMER' })],
    ['a person assigned to BOT_ACTIVE', () => ({ assigned: member() })],
    [
      'a person assigned to HUMAN_WAITING_Q',
      () => ({ state: 'HUMAN_WAITING_Q', assigned: member() }),
    ],
    [
      'a person assigned to CLOSED',
      () => ({ state: 'CLOSED', assigned: member(), closedAt: NOW, outcome: 'won' }),
    ],
    ['CLOSED without closed_at', () => ({ state: 'CLOSED', outcome: 'won' })],
    ['CLOSED without an outcome', () => ({ state: 'CLOSED', closedAt: NOW })],
    ['closed_at on an open conversation', () => ({ closedAt: NOW })],
    ['an outcome on an open conversation', () => ({ outcome: 'won' })],
    [
      'an outcome outside the four values',
      () => ({ state: 'CLOSED', closedAt: NOW, outcome: 'abandoned' }),
    ],
  ])('refuses %s (23514)', async (_name, over) => {
    expect(await sqlState(put(over()))).toBe('23514');
  });

  it('refuses a person who is not a member of the organisation (23503)', async () => {
    const stranger = users.get(B) as string;
    expect(await sqlState(put({ state: 'HUMAN_ACTIVE', assigned: stranger }))).toBe('23503');
  });

  it('has the inbox and the assignee indexes of Brief P8', async () => {
    const { rows } = await admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'conversations'
       AND indexname IN ('conversations_inbox_idx', 'conversations_assigned_idx') ORDER BY indexname`,
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      'conversations_assigned_idx',
      'conversations_inbox_idx',
    ]);
  });
});

describe('the guard trigger: only the state machine changes its columns', () => {
  const setState = `UPDATE conversations SET state = 'HUMAN_WAITING_Q', version = $2 WHERE id = $1`;
  const fsm = (value: string) => app.query("SELECT set_config('app.fsm', $1, true)", [value]);
  const fresh = async () => {
    const id = uuidv7();
    await put({}, id);
    return id;
  };

  it('refuses an UPDATE of a column it owns without the setting (FS001), for app_role and for migration_role', async () => {
    const id = await fresh();
    expect(await sqlState(asApp(app, A, [WA], () => app.query(setState, [id, 1])))).toBe('FS001');
    expect(await sqlState(admin.query(setState, [id, 1]))).toBe('FS001');
  });

  it('refuses it while the setting is anything but on', async () => {
    const id = await fresh();
    const attempt = () => fsm('off').then(() => app.query(setState, [id, 1]));
    expect(await sqlState(asApp(app, A, [WA], attempt))).toBe('FS001');
  });

  it('lets it through with the setting on and the version raised by exactly one', async () => {
    const id = await fresh();
    const update = () => fsm('on').then(() => app.query(setState, [id, 1]));
    expect((await asApp(app, A, [WA], update)).rowCount).toBe(1);
  });

  it.each([0, 2, 5])(
    'refuses version %i when it should be 1 (FS002), even with the setting on',
    async (version) => {
      const id = await fresh();
      const update = () => fsm('on').then(() => app.query(setState, [id, version]));
      expect(await sqlState(asApp(app, A, [WA], update))).toBe('FS002');
    },
  );

  it('still enforces the invariants with the setting on (23514)', async () => {
    const id = await fresh();
    const toActive = () =>
      fsm('on').then(() =>
        app.query("UPDATE conversations SET state = 'HUMAN_ACTIVE', version = 1 WHERE id = $1", [
          id,
        ]),
      );
    expect(await sqlState(asApp(app, A, [WA], toActive))).toBe('23514');
  });

  it('lets any role change the columns it does not own, and write the same values back', async () => {
    const id = await fresh();
    const touch = () =>
      app.query(
        'UPDATE conversations SET last_message_at = now(), updated_at = now(), state = state WHERE id = $1',
        [id],
      );
    expect((await asApp(app, A, [WA], touch)).rowCount).toBe(1);
  });

  it('does not leak the setting: it ends with the transaction that set it', async () => {
    const id = await fresh();
    await app.query('BEGIN');
    try {
      await app.query(
        "SELECT set_config('app.current_org', $1, true), set_config('app.current_workspaces', $2, true)",
        [A, `{${WA}}`],
      );
      await fsm('on');
      await app.query(setState, [id, 1]);
      await app.query('COMMIT');
    } finally {
      await app.query('ROLLBACK').catch(() => undefined);
    }
    const next = () =>
      app.query("UPDATE conversations SET state = 'BOT_ACTIVE', version = 2 WHERE id = $1", [id]);
    expect(await sqlState(asApp(app, A, [WA], next))).toBe('FS001');
  });

  it('is a function nobody but the trigger machinery can call', async () => {
    const { rows } = await admin.query<{ role: string; ok: boolean }>(
      `SELECT r AS role, has_function_privilege(r, 'app.conversations_fsm_guard()', 'EXECUTE') AS ok
       FROM unnest(ARRAY['app_role', 'support_role', 'auth_role', 'public']) AS r`,
    );
    expect(rows.filter((r) => r.ok)).toEqual([]);
  });
});
