import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, insertPendingDelivery, withTenant } from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// message_deliveries (202610211000, N146): the pending row of a send, its constraints and what app_role may change. RLS by organisation
// and workspace and the grants by column are also swept by rls-all-tables.spec and grants.spec.
const A = uuidv7();
const WA2 = uuidv7();
let [WA, CA, CONV, user] = ['', '', '', ''];
let admin: pg.Client;
let pool: pg.Pool;

const pending = (over: { workspaceIds?: string[]; channel?: string; message?: string } = {}) => {
  const d = {
    id: uuidv7(),
    workspaceId: WA,
    conversationId: CONV,
    messageId: over.message ?? uuidv7(),
    channelAccountId: over.channel ?? CA,
  };
  return withTenant(pool, { orgId: A, workspaceIds: over.workspaceIds ?? [WA] }, (tx) =>
    insertPendingDelivery(tx, d),
  ).then(() => d);
};
/** One statement as app_role in the tenant of A and WA, committed. */
async function asApp(sql: string, params: unknown[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.current_org', $1, true), set_config('app.current_workspaces', $2, true)",
      [A, `{${WA}}`],
    );
    await client.query(sql, params);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  user = await seedTenant(admin, A);
  const one = async (sql: string) =>
    ((await admin.query<{ id: string }>(sql, [A])).rows[0] as { id: string }).id;
  WA = await one('SELECT id FROM workspaces WHERE org_id = $1');
  CA = await one('SELECT id FROM channel_accounts WHERE org_id = $1');
  CONV = await one('SELECT id FROM conversations WHERE org_id = $1');
  await admin.query(
    "INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')",
    [WA2, A],
  );
});

afterAll(async () => {
  await cleanupTenant(admin, A, user);
  await admin.end();
  await pool.end();
});

describe('insertPendingDelivery', () => {
  it('writes a pending row with no attempt yet, in the organisation of the transaction', async () => {
    const d = await pending();
    const { rows } = await admin.query(
      'SELECT org_id, status, attempts, last_error, sent_at FROM message_deliveries WHERE id = $1',
      [d.id],
    );
    expect(rows).toEqual([
      { org_id: A, status: 'pending', attempts: 0, last_error: null, sent_at: null },
    ]);
  });

  it('has one delivery per message, and refuses a workspace outside the context or a channel of another workspace', async () => {
    const d = await pending();
    expect(await sqlState(pending({ message: d.messageId }))).toBe('23505');
    expect(await sqlState(pending({ workspaceIds: [WA2] }))).toBe('42501');
    const other = uuidv7();
    await admin.query(
      "INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name) VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA2')",
      [other, A, WA2, `oa-${other}`],
    );
    expect(await sqlState(pending({ channel: other }))).toBe('23503');
  });
});

describe('what app_role may change', () => {
  it('moves a delivery to sent with when and the id of the platform, or to failed with a code', async () => {
    const [sent, failed] = [await pending(), await pending()];
    await asApp(
      `UPDATE message_deliveries SET status = 'sent', sent_at = now(), platform_message_id = 'zm-1', attempts = 1 WHERE id = $1`,
      [sent.id],
    );
    await asApp(
      `UPDATE message_deliveries SET status = 'failed', last_error = 'E_CHANNEL_DOWN', attempts = 5 WHERE id = $1`,
      [failed.id],
    );
    const { rows } = await admin.query<{ status: string }>(
      'SELECT status FROM message_deliveries WHERE id = ANY($1::uuid[]) ORDER BY status',
      [[sent.id, failed.id]],
    );
    expect(rows.map((r) => r.status)).toEqual(['failed', 'sent']);
  });

  it('refuses a sent row without its time or id, an error that is not a code, and a negative count', async () => {
    const d = await pending();
    const set = (assignments: string) =>
      sqlState(asApp(`UPDATE message_deliveries SET ${assignments} WHERE id = $1`, [d.id]));
    expect(await set("status = 'sent'")).toBe('23514');
    expect(await set("status = 'sent', sent_at = now()")).toBe('23514');
    expect(await set("last_error = 'connection reset by peer'")).toBe('23514');
    expect(await set('attempts = -1')).toBe('23514');
  });

  it('cannot change what the row is about, nor delete it', async () => {
    const d = await pending();
    const set = (sql: string) => sqlState(asApp(sql, [d.id]));
    expect(
      await set(`UPDATE message_deliveries SET message_id = gen_random_uuid() WHERE id = $1`),
    ).toBe('42501');
    expect(
      await set(`UPDATE message_deliveries SET org_id = gen_random_uuid() WHERE id = $1`),
    ).toBe('42501');
    expect(await set('DELETE FROM message_deliveries WHERE id = $1')).toBe('42501');
  });
});
