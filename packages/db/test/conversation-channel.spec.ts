import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The channel columns of conversations (202610071310, N105): the foreign key of the channel account (org AND workspace), the check
// "both or neither", and the unique key of the conversation that is open for one person on one channel account (I2).
// Org A has workspaces WA and WA2 (an account in each); org B is a stranger.
const [A, B, WA2, CA2] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const users = new Map<string, string>();
let [WA, CA, CB, WB] = ['', '', '', ''];
let admin: pg.Client;
let app: pg.Client;

interface ConvOver {
  org?: string;
  workspace?: string;
  channel?: string | null;
  user?: string | null;
  state?: string;
}
function conv(over: ConvOver = {}, id = uuidv7()) {
  const v = { org: A, workspace: WA, channel: CA, user: 'zu-1', state: 'BOT_ACTIVE', ...over };
  const closed = v.state === 'CLOSED';
  return admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state, closed_at, outcome, channel_account_id, external_user_id)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::boolean THEN now() END, CASE WHEN $5::boolean THEN 'resolved' END, $6, $7)`,
    [id, v.org, v.workspace, v.state, closed, v.channel, v.user],
  );
}
const person = () => `zu-${uuidv7()}`;

beforeAll(async () => {
  [admin, app] = [
    new pg.Client({ connectionString: url('migration') }),
    new pg.Client({ connectionString: url('app') }),
  ];
  await Promise.all([admin.connect(), app.connect()]);
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  const one = async (sql: string, org: string) =>
    ((await admin.query<{ id: string }>(sql, [org])).rows[0] as { id: string }).id;
  WA = await one('SELECT id FROM workspaces WHERE org_id = $1', A);
  WB = await one('SELECT id FROM workspaces WHERE org_id = $1', B);
  CA = await one('SELECT id FROM channel_accounts WHERE org_id = $1', A);
  CB = await one('SELECT id FROM channel_accounts WHERE org_id = $1', B);
  await admin.query(
    "INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')",
    [WA2, A],
  );
  await admin.query(
    "INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name) VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA2')",
    [CA2, A, WA2, `oa-${CA2}`],
  );
});

afterAll(async () => {
  await app.end();
  await admin.query('DELETE FROM conversations WHERE org_id = ANY($1::uuid[])', [[A, B]]);
  await admin.query('DELETE FROM channel_accounts WHERE id = $1', [CA2]);
  await admin.query('DELETE FROM workspaces WHERE id = $1', [WA2]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('the channel account', () => {
  it('takes an account of the same organisation and workspace', async () => {
    await conv({ user: person() });
    await conv({ workspace: WA2, channel: CA2, user: person() });
  });

  // The tables of it.each are built before beforeAll (N103): what beforeAll sets is read inside a function, never in the table.
  it.each<[string, () => ConvOver]>([
    ['an account of another organisation', () => ({ channel: CB })],
    ['an account of another workspace of the same organisation', () => ({ channel: CA2 })],
    ['a workspace of another organisation', () => ({ workspace: WB })],
  ])('refuses %s (23503)', async (_name, over) => {
    expect(await sqlState(conv({ user: person(), ...over() }))).toBe('23503');
  });
});

describe('both or neither', () => {
  it.each<[string, ConvOver]>([
    ['an account without a person', { user: null }],
    ['a person without an account', { channel: null }],
    ['a blank person', { user: ' ' }],
  ])('refuses %s (23514)', async (_name, over) => {
    expect(await sqlState(conv(over))).toBe('23514');
  });

  it('keeps the conversations of M1.2 as they are: no channel, no person, no last customer message', async () => {
    const id = uuidv7();
    await admin.query(
      "INSERT INTO conversations (id, org_id, workspace_id, state) VALUES ($1, $2, $3, 'BOT_ACTIVE')",
      [id, A, WA],
    );
    const { rows } = await admin.query(
      'SELECT channel_account_id, external_user_id, last_customer_message_at FROM conversations WHERE id = $1',
      [id],
    );
    expect(rows).toEqual([
      { channel_account_id: null, external_user_id: null, last_customer_message_at: null },
    ]);
  });
});

describe('one open conversation for one person on one channel account (I2)', () => {
  it('refuses a second open conversation for the same pair (23505), in any open state', async () => {
    const user = person();
    await conv({ user });
    expect(await sqlState(conv({ user }))).toBe('23505');
    expect(await sqlState(conv({ user, state: 'HUMAN_WAITING_Q' }))).toBe('23505');
  });

  it('lets a closed conversation and an open one share a pair, and any number of closed ones', async () => {
    const user = person();
    await conv({ user, state: 'CLOSED' });
    await conv({ user });
    const other = person();
    await conv({ user: other, state: 'CLOSED' });
    await conv({ user: other, state: 'CLOSED' });
    await conv({ user: other });
  });

  it('does not limit the conversations without a channel', async () => {
    for (let i = 0; i < 3; i++) await conv({ channel: null, user: null });
  });

  it('keeps the pairs apart: another person, or the same person on another account', async () => {
    const user = person();
    await conv({ user });
    await conv({ user: person() });
    await conv({ workspace: WA2, channel: CA2, user });
  });

  it('refuses to reopen a closed conversation while another one of the pair is open (23505), as the processor must look for the open one first', async () => {
    const [user, closed] = [person(), uuidv7()];
    await conv({ user, state: 'CLOSED' }, closed);
    await conv({ user });
    await admin.query('BEGIN');
    try {
      await admin.query("SELECT set_config('app.fsm', 'on', true)");
      const reopen = admin.query(
        "UPDATE conversations SET state = 'BOT_ACTIVE', closed_at = NULL, outcome = NULL, version = version + 1 WHERE id = $1",
        [closed],
      );
      expect(await sqlState(reopen)).toBe('23505');
    } finally {
      await admin.query('ROLLBACK').catch(() => undefined);
    }
  });
});

describe('the last message of the customer', () => {
  it('can be written by app_role without the state machine: the FSM guard does not watch it', async () => {
    const id = uuidv7();
    await conv({ user: person() }, id);
    const done = await asApp(app, A, [WA], () =>
      app.query('UPDATE conversations SET last_customer_message_at = now() WHERE id = $1', [id]),
    );
    expect(done.rowCount).toBe(1);
  });
});
