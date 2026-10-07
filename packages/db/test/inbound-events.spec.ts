import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// inbound_events (inbound-spec §1): O by organisation, partitioned by month, the foreign key of the channel account (org AND workspace),
// the checks, UPDATE by column, and which columns each role can read. The row rules of every RLS table (ENABLE + FORCE, the two
// policies, no DELETE, TN001) and of every partition are also covered by rls-all-tables.spec and partitions.spec, which read the catalog.
const [A, B] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
let [WA, WA2, WB, CA, CB] = ['', '', '', '', ''];
let admin: pg.Client;
let app: pg.Client;

interface EventOver {
  org?: string;
  workspace?: string;
  channel?: string;
  messageId?: string;
  type?: string;
  status?: string;
  attempts?: number;
  claimed?: boolean;
  processed?: boolean;
  lastError?: string | null;
  receivedAt?: string;
}
function addEvent(over: EventOver = {}, id = uuidv7()) {
  const v = {
    org: A,
    workspace: WA,
    channel: CA,
    messageId: `m-${id}`,
    type: 'user_send_text',
    status: 'pending',
    attempts: 0,
    claimed: false,
    processed: false,
    lastError: null,
    receivedAt: new Date().toISOString(),
    ...over,
  };
  return admin.query(
    `INSERT INTO inbound_events (id, org_id, workspace_id, channel_account_id, platform_message_id, event_type, payload, received_at, status, attempts, claimed_at, processed_at, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, '{"x": 1}', $7, $8, $9, CASE WHEN $10::boolean THEN now() END, CASE WHEN $11::boolean THEN now() END, $12)`,
    [
      id,
      v.org,
      v.workspace,
      v.channel,
      v.messageId,
      v.type,
      v.receivedAt,
      v.status,
      v.attempts,
      v.claimed,
      v.processed,
      v.lastError,
    ],
  );
}
const asA = <T>(fn: () => Promise<T>) => asApp(app, A, [], fn);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  const one = async (sql: string, org: string) =>
    ((await admin.query<{ id: string }>(sql, [org])).rows[0] as { id: string }).id;
  WA = await one('SELECT id FROM workspaces WHERE org_id = $1', A);
  WB = await one('SELECT id FROM workspaces WHERE org_id = $1', B);
  CA = await one('SELECT id FROM channel_accounts WHERE org_id = $1', A);
  CB = await one('SELECT id FROM channel_accounts WHERE org_id = $1', B);
  WA2 = uuidv7();
  await admin.query(
    "INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')",
    [WA2, A],
  );
});

afterAll(async () => {
  await app.end();
  await admin.query('DELETE FROM inbound_events WHERE org_id = ANY($1::uuid[])', [[A, B]]);
  await admin.query('DELETE FROM workspaces WHERE id = $1', [WA2]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('isolation and the channel account', () => {
  it('shows a tenant its own events only, and refuses to write for another org (42501)', async () => {
    const [mine, theirs] = [uuidv7(), uuidv7()];
    await addEvent({}, mine);
    await addEvent({ org: B, workspace: WB, channel: CB }, theirs);
    const seen = await asA(async () =>
      (await app.query<{ id: string }>('SELECT id FROM inbound_events')).rows.map((r) => r.id),
    );
    expect(seen).toContain(mine);
    expect(seen).not.toContain(theirs);
    const insert = asA(() =>
      app.query(
        `INSERT INTO inbound_events (id, org_id, workspace_id, channel_account_id, platform_message_id, event_type, payload)
         VALUES ($1, $2, $3, $4, 'm', 't', '{}')`,
        [uuidv7(), B, WB, CB],
      ),
    );
    expect(await sqlState(insert)).toBe('42501');
  });

  // The tables of it.each are built before beforeAll (N103): what beforeAll sets is read inside a function, never in the table.
  it.each<[string, () => EventOver]>([
    ['a channel account of another organisation', () => ({ channel: CB })],
    ['a workspace of another organisation', () => ({ workspace: WB })],
    ['a workspace that is not the one of the channel account', () => ({ workspace: WA2 })],
  ])('refuses %s (23503)', async (_name, over) => {
    expect(await sqlState(addEvent(over()))).toBe('23503');
  });
});

describe('columns and checks', () => {
  it.each<[string, EventOver]>([
    ['an unknown status', { status: 'done' }],
    ['a blank message id', { messageId: ' ' }],
    ['a blank event type', { type: ' ' }],
    ['negative attempts', { attempts: -1 }],
    ['a processed event without processed_at', { status: 'processed' }],
    ['a pending event with processed_at', { processed: true }],
    ['a claimed event without claimed_at', { status: 'claimed' }],
    ['an ignored event without a reason', { status: 'ignored', processed: true }],
    ['a last_error of 65 characters', { lastError: 'x'.repeat(65) }],
    ['a blank last_error', { lastError: ' ' }],
  ])('rejects %s (23514)', async (_name, over) => {
    expect(await sqlState(addEvent(over))).toBe('23514');
  });

  it('accepts every valid state, and the same message in two months (the table alone does not stop duplicates)', async () => {
    await addEvent({ status: 'claimed', claimed: true, attempts: 1 });
    await addEvent({ status: 'processed', processed: true });
    await addEvent({ status: 'ignored', processed: true, lastError: 'E_NOT_A_MESSAGE' });
    await addEvent({ status: 'dead_letter', attempts: 5, lastError: 'E_X' });
    const messageId = 'same';
    await addEvent({ messageId, receivedAt: '2001-02-15T00:00:00Z' });
    await addEvent({ messageId, receivedAt: '2001-03-15T00:00:00Z' });
  });

  it('routes a row to the monthly partition of its date, an old date to DEFAULT', async () => {
    const [now, old] = [uuidv7(), uuidv7()];
    await addEvent({}, now);
    await addEvent({ receivedAt: '2001-01-01T00:00:00Z' }, old);
    const child = async (id: string) =>
      (
        await admin.query<{ c: string }>(
          'SELECT tableoid::regclass::text AS c FROM inbound_events WHERE id = $1',
          [id],
        )
      ).rows[0]?.c;
    expect(await child(now)).toMatch(/^inbound_events_y\d{4}m\d{2}$/);
    expect(await child(old)).toBe('inbound_events_default');
  });
});

describe('what app_role may change', () => {
  const set = (id: string, sql: string) =>
    asA(() => app.query(`UPDATE inbound_events SET ${sql} WHERE id = $1`, [id]));

  it('lets the columns that follow the worker change', async () => {
    const id = uuidv7();
    await addEvent({}, id);
    expect(
      await sqlState(
        set(
          id,
          "status = 'dead_letter', attempts = 5, available_at = now(), claimed_at = NULL, processed_at = NULL, last_error = 'E_X'",
        ),
      ),
    ).toBeUndefined();
  });

  it.each<[string, () => string]>([
    ['payload', () => "payload = '{}'"],
    ['org_id', () => `org_id = '${B}'`],
    ['workspace_id', () => `workspace_id = '${WB}'`],
    ['channel_account_id', () => `channel_account_id = '${uuidv7()}'`],
    ['platform_message_id', () => "platform_message_id = 'other'"],
    ['event_type', () => "event_type = 'other'"],
    ['received_at', () => 'received_at = now()'],
    ['id', () => `id = '${uuidv7()}'`],
  ])('refuses to change %s (42501)', async (_column, sql) => {
    const id = uuidv7();
    await addEvent({}, id);
    expect(await sqlState(set(id, sql()))).toBe('42501');
  });

  it('cannot DELETE', async () => {
    expect(await sqlState(asA(() => app.query('DELETE FROM inbound_events')))).toBe('42501');
  });
});

describe('what each role may read and change, from the catalog', () => {
  const COLUMNS =
    'id org_id workspace_id channel_account_id platform_message_id event_type payload received_at status attempts available_at claimed_at processed_at last_error'.split(
      ' ',
    );
  const privilege = async (role: string, column: string, kind: 'SELECT' | 'UPDATE') =>
    (
      await admin.query<{ ok: boolean }>('SELECT has_column_privilege($1, $2, $3, $4) AS ok', [
        role,
        'public.inbound_events',
        column,
        kind,
      ])
    ).rows[0]?.ok;

  it('keeps exactly the expected columns: a new one has to be looked at here', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inbound_events' ORDER BY ordinal_position",
    );
    expect(rows.map((r) => r.column_name)).toEqual(COLUMNS);
  });

  it('support_role reads every column except payload, and changes none', async () => {
    for (const column of COLUMNS) {
      expect(await privilege('support_role', column, 'SELECT'), column).toBe(column !== 'payload');
      expect(await privilege('support_role', column, 'UPDATE'), column).toBe(false);
    }
  });

  it('app_role reads every column and changes exactly the columns that follow the worker', async () => {
    const mayChange = [
      'status',
      'attempts',
      'available_at',
      'claimed_at',
      'processed_at',
      'last_error',
    ];
    for (const column of COLUMNS) {
      expect(await privilege('app_role', column, 'SELECT'), column).toBe(true);
      expect(await privilege('app_role', column, 'UPDATE'), column).toBe(
        mayChange.includes(column),
      );
    }
  });
});
