import { ConversationStateMachine, MessageService } from '@gani/conversations';
import {
  claimInboundBatch,
  insertIfAbsent,
  withTenant,
  type ClaimedInboundEvent,
  type TenantTx,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InboundLeaseLostError, processInboundEvent } from '../src/inbound/process-event.js';
import { adminPool, appPool, seedOrg, type Pool } from './db.js';

// processInboundEvent on PostgreSQL as app_role (inbound spec §3): a Zalo event in the shape the fixtures assume (Q6, N139) becomes a
// message in that person's conversation, with its rows in the outbox, in one transaction. No Valkey: the queue is not involved here.
let admin: Pool;
let app: Pool;
let org = '';
const [ws, account] = [uuidv7(), uuidv7()];
const fsm = new ConversationStateMachine();
const services = {
  fsm,
  messages: new MessageService(fsm, undefined, undefined, { warn: () => undefined }),
};
const tenant = () => ({ orgId: org, workspaceIds: [ws] });

const zalo = (person: string, over: Record<string, unknown> = {}) => ({
  event_name: 'user_send_text',
  timestamp: String(Date.now()),
  sender: { id: person },
  message: { msg_id: `m-${uuidv7()}`, text: 'xin chào' },
  ...over,
});
/** Stores the event as the webhook does, then claims it as the processor does; returns the claimed row. */
async function arrive(payload: Record<string, unknown>): Promise<ClaimedInboundEvent> {
  const id = uuidv7();
  await withTenant(app, tenant(), (tx) =>
    insertIfAbsent(tx, {
      id,
      workspaceId: ws,
      channelAccountId: account,
      platformMessageId: String(
        (payload['message'] as { msg_id?: string } | undefined)?.msg_id ?? `raw:${id}`,
      ),
      eventType: String(payload['event_name']),
      payload,
    }),
  );
  const claimed = await withTenant(app, tenant(), (tx) =>
    claimInboundBatch(tx, { limit: 100, workspaceId: ws }),
  );
  const mine = claimed.find((e) => e.id === id);
  if (!mine) throw new Error('the event was not claimed');
  return mine;
}
const process = (event: ClaimedInboundEvent, now?: Date) =>
  withTenant(app, tenant(), (tx: TenantTx) => processInboundEvent(tx, event, services, now));
const rows = async <T>(sql: string, params: unknown[]) =>
  (await admin.query(sql, params)).rows as T[];
const conversationsOf = (person: string) =>
  rows<{ id: string; state: string }>(
    'SELECT id, state FROM conversations WHERE external_user_id = $1 ORDER BY created_at',
    [person],
  );

beforeAll(async () => {
  [admin, app] = [adminPool(), appPool()];
  org = await seedOrg(admin);
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`,
    [ws, org, `w-${ws}`],
  );
  await admin.query(
    `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, status)
     VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA', 'connected')`,
    [account, org, ws, `oa-${account}`],
  );
});

afterAll(async () => {
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
  await admin.query('DELETE FROM organizations WHERE id = $1', [org]).catch(() => undefined);
  await Promise.all([admin.end(), app.end()]);
});

describe('processInboundEvent', () => {
  it('turns the first message of a person into a conversation of the channel, a message and their outbox rows', async () => {
    const person = `zu-${uuidv7()}`;
    expect(await process(await arrive(zalo(person)))).toBe('processed');
    const [conversation] = await conversationsOf(person);
    expect(conversation?.state).toBe('BOT_ACTIVE');
    const messages = await rows(
      'SELECT sequence_number::int AS sequence_number, sender_kind, kind, body FROM messages WHERE conversation_id = $1',
      [conversation?.id],
    );
    expect(messages).toEqual([
      { sequence_number: 1, sender_kind: 'customer', kind: 'text', body: 'xin chào' },
    ]);
    const outbox = await rows<{ event_type: string }>(
      "SELECT event_type FROM outbox_events WHERE aggregate_id = $1 OR payload->>'conversationId' = $1::text ORDER BY created_at",
      [conversation?.id],
    );
    expect(outbox.map((o) => o.event_type).sort()).toEqual([
      'conversation.created',
      'message.created',
    ]);
  });

  it('puts the next message of the same person in the same conversation, and marks each event processed', async () => {
    const person = `zu-${uuidv7()}`;
    const first = await arrive(zalo(person));
    await process(first);
    await process(
      await arrive(
        zalo(person, { event_name: 'user_send_image', message: { msg_id: `m-${uuidv7()}` } }),
      ),
    );
    const [conversation, extra] = await conversationsOf(person);
    expect(extra).toBeUndefined();
    expect(
      await rows(
        'SELECT sequence_number::int AS sequence_number, kind, body FROM messages WHERE conversation_id = $1 ORDER BY sequence_number',
        [conversation?.id],
      ),
    ).toEqual([
      { sequence_number: 1, kind: 'text', body: 'xin chào' },
      { sequence_number: 2, kind: 'image', body: null },
    ]);
    expect(await rows('SELECT status FROM inbound_events WHERE id = $1', [first.id])).toEqual([
      { status: 'processed' },
    ]);
  });

  it('makes one conversation of two first messages of one person processed at once (the lock of the person)', async () => {
    const person = `zu-${uuidv7()}`;
    const [a, b] = [await arrive(zalo(person)), await arrive(zalo(person))];
    expect(await Promise.all([process(a), process(b)])).toEqual(['processed', 'processed']);
    const [conversation, extra] = await conversationsOf(person);
    expect(extra).toBeUndefined();
    expect(
      await rows('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [
        conversation?.id,
      ]),
    ).toEqual([{ n: 2 }]);
  });

  it('ignores what is not a message with a fixed reason, and makes no conversation', async () => {
    const person = `zu-${uuidv7()}`;
    const event = await arrive(zalo(person, { event_name: 'follow' }));
    expect(await process(event)).toBe('ignored');
    expect(
      await rows('SELECT status, last_error FROM inbound_events WHERE id = $1', [event.id]),
    ).toEqual([{ status: 'ignored', last_error: 'I_NOT_A_MESSAGE' }]);
    expect(await conversationsOf(person)).toEqual([]);
  });

  it('reopens a conversation closed within 72 hours (T14), and starts a new one after', async () => {
    const [recent, old] = [`zu-${uuidv7()}`, `zu-${uuidv7()}`];
    for (const [person, hours] of [
      [recent, 2],
      [old, 100],
    ] as const)
      await admin.query(
        `INSERT INTO conversations (id, org_id, workspace_id, state, closed_at, outcome, channel_account_id, external_user_id)
         VALUES ($1, $2, $3, 'CLOSED', now() - make_interval(hours => $4), 'resolved', $5, $6)`,
        [uuidv7(), org, ws, hours, account, person],
      );
    await process(await arrive(zalo(recent)));
    await process(await arrive(zalo(old)));
    expect((await conversationsOf(recent)).map((c) => c.state)).toEqual(['BOT_ACTIVE']);
    expect((await conversationsOf(old)).map((c) => c.state)).toEqual(['CLOSED', 'BOT_ACTIVE']);
  });

  it('rolls everything back when the claim was lost, so another worker stores the message once', async () => {
    const person = `zu-${uuidv7()}`;
    const event = await arrive(zalo(person));
    await admin.query(
      `UPDATE inbound_events SET status = 'pending', claimed_at = NULL WHERE id = $1`,
      [event.id],
    );
    await expect(process(event)).rejects.toBeInstanceOf(InboundLeaseLostError);
    expect(await conversationsOf(person)).toEqual([]);
  });
});
