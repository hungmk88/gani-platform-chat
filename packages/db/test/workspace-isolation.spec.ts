import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Spec RLS M01 §7 case 5 and the O+W rule of §4.12: `conversations` is seen and written only inside the workspaces of the session.
// Org A has two workspaces (WA, WB) with one conversation each; org B only supplies a foreign workspace for the foreign key test.
const [A, B] = [uuidv7(), uuidv7()];
const [WB, CA, CB] = [uuidv7(), uuidv7(), uuidv7()];
const users = new Map<string, string>();
let WA = '';
let WOTHER = '';
let admin: pg.Client;
let app: pg.Client;

const insertSql = `INSERT INTO conversations (id, org_id, workspace_id, state) VALUES ($1, $2, $3, $4)`;

/** Runs `fn` in a transaction of app_role whose context is org A and the given workspaces; always rolled back. */
async function asApp<T>(workspaceIds: string[] | null, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    await app.query("SELECT set_config('app.current_org', $1, true)", [A]);
    if (workspaceIds) {
      await app.query("SELECT set_config('app.current_workspaces', $1, true)", [
        `{${workspaceIds.join(',')}}`,
      ]);
    }
    return await fn();
  } finally {
    await app.query('ROLLBACK').catch(() => undefined);
  }
}
const ids = async () =>
  (await app.query<{ id: string }>('SELECT id FROM conversations')).rows.map((r) => r.id);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  const workspace = (org: string) =>
    admin
      .query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [org])
      .then((r) => r.rows[0]?.id as string);
  [WA, WOTHER] = [await workspace(A), await workspace(B)];
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws-b', 'WB', 'service')`,
    [WB, A],
  );
  await admin.query(insertSql, [CA, A, WA, 'BOT_ACTIVE']);
  await admin.query(insertSql, [CB, A, WB, 'BOT_ACTIVE']);
});

afterAll(async () => {
  await app.end();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('case 5: workspace isolation of conversations', () => {
  it('with {WA} shows the conversations of WA and never those of WB (same org)', async () => {
    const seen = await asApp([WA], ids);
    expect(seen).toContain(CA);
    expect(seen).not.toContain(CB);
  });

  it('with {WA} UPDATE reaches a row of WA and no row of WB (0 rows, not an error)', async () => {
    // A column the state machine does not own: the columns it owns are refused by the guard trigger (conversations-fsm.spec).
    const own = await asApp([WA], () =>
      app.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [CA]),
    );
    expect(own.rowCount).toBe(1);
    const foreign = await asApp([WA], () =>
      app.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [CB]),
    );
    expect(foreign.rowCount).toBe(0);
  });

  it('with {WA} an UPDATE that moves a row from WA to WB is refused by WITH CHECK (42501)', async () => {
    const move = () =>
      app.query('UPDATE conversations SET workspace_id = $1 WHERE id = $2', [WB, CA]);
    expect(await sqlState(asApp([WA], move))).toBe('42501');
  });

  it('with {WA} an INSERT into WB is refused (42501)', async () => {
    const insert = () => app.query(insertSql, [uuidv7(), A, WB, 'BOT_ACTIVE']);
    expect(await sqlState(asApp([WA], insert))).toBe('42501');
  });

  it('with {} nothing is visible and nothing can be inserted', async () => {
    expect(await asApp([], ids)).toEqual([]);
    const insert = () => app.query(insertSql, [uuidv7(), A, WA, 'BOT_ACTIVE']);
    expect(await sqlState(asApp([], insert))).toBe('42501');
  });

  it('with both workspaces, both conversations are visible', async () => {
    expect(await asApp([WA, WB], ids)).toEqual(expect.arrayContaining([CA, CB]));
  });

  it('without a context it raises TN001, and so does an org context without workspaces', async () => {
    expect(await sqlState(app.query('SELECT 1 FROM conversations'))).toBe('TN001');
    expect(await sqlState(asApp(null, ids))).toBe('TN001');
  });
});

describe('the columns of conversations', () => {
  it('accepts the five states of the state machine and nothing else (23514)', async () => {
    // Each state with the columns its invariants ask for (conversations-fsm.spec checks the invariants themselves).
    const member = users.get(A);
    const full = `INSERT INTO conversations (id, org_id, workspace_id, state, assigned_user_id, closed_at, outcome)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    const now = new Date();
    for (const [state, assigned, closedAt, outcome] of [
      ['BOT_ACTIVE', null, null, null],
      ['HUMAN_WAITING_Q', null, null, null],
      ['HUMAN_ACTIVE', member, null, null],
      ['PENDING_CUSTOMER', member, null, null],
      ['CLOSED', null, now, 'resolved'],
    ] as const) {
      await admin.query(full, [uuidv7(), A, WA, state, assigned, closedAt, outcome]);
    }
    for (const state of ['bot_active', 'OPEN', '']) {
      expect(await sqlState(admin.query(insertSql, [uuidv7(), A, WA, state])), state).toBe('23514');
    }
  });

  it('has no default for state (23502) and version starts at 0', async () => {
    const noState = admin.query(
      'INSERT INTO conversations (id, org_id, workspace_id) VALUES ($1, $2, $3)',
      [uuidv7(), A, WA],
    );
    expect(await sqlState(noState)).toBe('23502');
    const { rows } = await admin.query<{ version: number }>(
      'SELECT version FROM conversations WHERE id = $1',
      [CA],
    );
    expect(rows[0]?.version).toBe(0);
  });

  it('refuses a workspace of another organisation (23503)', async () => {
    expect(await sqlState(admin.query(insertSql, [uuidv7(), A, WOTHER, 'BOT_ACTIVE']))).toBe(
      '23503',
    );
  });
});
