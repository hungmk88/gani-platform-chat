import { insertIfAbsent, withTenant } from '@gani/db';
import { uuidv7 } from '@gani/domain';

import type { Pool } from './db.js';

// The inbound side of the tests of the real worker: the workspaces and Zalo accounts of an organisation, events stored as the webhook
// stores them (as app_role, through insertIfAbsent, in the shape the fixtures of N139 assume), and what is left after a test.

export interface Space {
  readonly ws: string;
  readonly account: string;
}

/** `count` workspaces of the organisation, each with one connected Zalo account. */
export async function seedSpaces(admin: Pool, org: string, count: number): Promise<Space[]> {
  const spaces = Array.from({ length: count }, () => ({ ws: uuidv7(), account: uuidv7() }));
  for (const { ws, account } of spaces) {
    await admin.query(
      `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`,
      [ws, org, `w-${ws}`],
    );
    await admin.query(
      `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, status)
       VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA', 'connected')`,
      [account, org, ws, `oa-${account}`],
    );
  }
  return spaces;
}

/** Stores one webhook event of `person` (a name unique within the organisation) as the webhook does. */
export async function arrive(
  app: Pool,
  org: string,
  { ws, account }: Space,
  person: string,
  name = 'user_send_text',
): Promise<void> {
  const msgId = `m-${uuidv7()}`;
  await withTenant(app, { orgId: org, workspaceIds: [ws] }, (tx) =>
    insertIfAbsent(tx, {
      id: uuidv7(),
      workspaceId: ws,
      channelAccountId: account,
      platformMessageId: msgId,
      eventType: name,
      payload: {
        event_name: name,
        timestamp: String(Date.now()),
        sender: { id: `${org}-${person}` },
        message: { msg_id: msgId, text: 'xin chào' },
      },
    }),
  );
}

/** How many inbound events of the organisation are in each status, by name. */
export async function inboundStatuses(admin: Pool, org: string): Promise<Record<string, number>> {
  const { rows } = await admin.query<{ status: string; n: number }>(
    'SELECT status, count(*)::int AS n FROM inbound_events WHERE org_id = $1 GROUP BY status',
    [org],
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

/** One number from a query of the organisation (`$1`), as `n`. */
export async function countOf(admin: Pool, org: string, sql: string): Promise<number> {
  return ((await admin.query<{ n: number }>(sql, [org])).rows[0] as { n: number }).n;
}

/** Removes what the processing wrote, before the suite removes the organisation. A step that fails does not throw. */
export async function removeInbound(admin: Pool, org: string): Promise<void> {
  for (const table of [
    'outbox_events',
    'conversation_events',
    'messages',
    'conversations',
    'inbound_events',
    'inbound_event_keys',
    'channel_accounts',
    'workspaces',
  ])
    await admin.query(`DELETE FROM ${table} WHERE org_id = $1`, [org]).catch(() => undefined);
}
