import { previewOf } from '@gani/domain';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import { cursorString, cursorWhole, decodeCursor, encodeCursor } from './cursor.js';
import { customerSearchWhere, type CustomerSearch } from './customer-read.js';
import { channelAccounts } from './schema/channel-accounts.js';
import { conversations } from './schema/conversations.js';
import { customers } from './schema/customers.js';
import { messageDeliveries } from './schema/message-deliveries.js';
import { messages } from './schema/messages.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// What the Inbox reads (API /v1/conversations, Brief P9). Every query runs in the caller's TenantTx, so RLS limits it to the org and
// the workspaces of the session: a conversation of another tenant is simply not found. The scope of a role inside those workspaces
// (Phụ lục B: sales and support see their own and the unclaimed ones) is passed in by the API, which owns the permission table.

export interface ConversationView {
  readonly id: string;
  readonly workspaceId: string;
  readonly state: string;
  readonly afterHoursHold: boolean;
  readonly assignedUserId: string | null;
  readonly version: number;
  readonly outcome: string | null;
  readonly closedAt: Date | null;
  readonly lastMessageAt: Date | null;
  readonly lastCustomerMessageAt: Date | null;
  readonly channelAccountId: string | null;
  readonly createdAt: Date;
  /** Who the customer is (N165): null until the inbound worker names them; `displayName` null until someone knows it. */
  readonly customer: { readonly id: string; readonly displayName: string | null } | null;
  /** The channel it came in by (U30): null for a conversation of no channel; a channel deleted since is still named. */
  readonly channel: {
    readonly id: string;
    readonly type: string;
    readonly displayName: string;
  } | null;
  /** Who holds it (U30): null when nobody does; `name` null when the person gave none or is no longer an active member. */
  readonly assignee: { readonly id: string; readonly name: string | null } | null;
  /** The line of the Inbox (U30, N169): the text of the last message, a label for another kind, null before any. PII: never logged. */
  readonly lastMessagePreview: string | null;
}

export interface ConversationListQuery {
  /** One of the session's workspaces; absent: all of them. */
  readonly workspaceId?: string;
  readonly states?: readonly string[];
  readonly afterHoursHold?: boolean;
  /** `none`: unassigned; a user id: assigned to that person. */
  readonly assigned?: 'none' | { readonly userId: string };
  /** Limit to what this person holds plus what nobody holds (the scope of sales and support). */
  readonly mineOrUnassigned?: string;
  /** The channel account it came in by (U30); one of another organisation or workspace simply matches nothing (RLS). */
  readonly channelAccountId?: string;
  /** Its live customer matches this search (U30), as the Khách hàng list searches; a conversation with no customer never does. */
  readonly customer?: CustomerSearch;
  readonly cursor?: string;
  /** 1..100 (P9). */
  readonly limit: number;
}

export interface Page<T> {
  readonly rows: readonly T[];
  readonly nextCursor: string | null;
}

// Most recent activity first; a conversation without a message yet counts from its creation. `id` breaks ties, so a page boundary
// never drops or repeats a row (index conversations_inbox_keyset_idx, migration 202610191400).
const SORT_KEY = sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`;
// The key as text with microseconds: a JavaScript Date would round it to milliseconds and the next page could repeat a row.
const SORT_TEXT = sql<string>`to_char(${SORT_KEY} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const SORT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const view = {
  id: conversations.id,
  workspaceId: conversations.workspaceId,
  state: conversations.state,
  afterHoursHold: conversations.afterHoursHold,
  assignedUserId: conversations.assignedUserId,
  version: conversations.version,
  outcome: conversations.outcome,
  closedAt: conversations.closedAt,
  lastMessageAt: conversations.lastMessageAt,
  lastCustomerMessageAt: conversations.lastCustomerMessageAt,
  channelAccountId: conversations.channelAccountId,
  createdAt: conversations.createdAt,
  customerId: conversations.customerId,
  customerName: customers.displayName,
  channelType: channelAccounts.type,
  channelName: channelAccounts.displayName,
  // Names only through app.org_users (active members, no email); a holder who left keeps their id with no name.
  assigneeName: sql<
    string | null
  >`(SELECT nullif(btrim(u.display_name), '') FROM app.org_users u WHERE u.user_id = ${conversations.assignedUserId})`,
  previewKind: conversations.lastMessageKind,
  previewText: conversations.lastMessagePreview,
};
type Row = Omit<ConversationView, 'customer' | 'channel' | 'assignee' | 'lastMessagePreview'> & {
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly channelType: string | null;
  readonly channelName: string | null;
  readonly assigneeName: string | null;
  readonly previewKind: string | null;
  readonly previewText: string | null;
};

const shape = (row: Row): ConversationView => {
  const {
    customerId,
    customerName,
    channelType,
    channelName,
    assigneeName,
    previewKind,
    previewText,
    ...rest
  } = row;
  return {
    ...rest,
    customer: customerId === null ? null : { id: customerId, displayName: customerName },
    channel:
      rest.channelAccountId === null || channelType === null || channelName === null
        ? null
        : { id: rest.channelAccountId, type: channelType, displayName: channelName },
    assignee: rest.assignedUserId === null ? null : { id: rest.assignedUserId, name: assigneeName },
    lastMessagePreview: previewOf(previewKind, previewText),
  };
};
const withoutSortKey = ({ sortKey, ...row }: Row & { readonly sortKey: string }) => {
  void sortKey;
  return shape(row);
};
// The customer's name rides along (N165): same organisation by the foreign key, and RLS on customers too.
const withCustomer = eq(customers.id, conversations.customerId);
// The channel by the pair of the foreign key (U30); not filtered on deleted_at: the conversation took place on it.
const withChannel = and(
  eq(channelAccounts.orgId, conversations.orgId),
  eq(channelAccounts.id, conversations.channelAccountId),
);

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError('limit must be 1..100');
}

/** The conversation as the Inbox shows it, or `null` when it does not exist or RLS hides it. No `external_user_id` (an identifier). */
export async function loadConversationView(
  tx: TenantTx,
  id: string,
): Promise<ConversationView | null> {
  const [row] = await tx
    .select(view)
    .from(conversations)
    .leftJoin(customers, withCustomer)
    .leftJoin(channelAccounts, withChannel)
    .where(eq(conversations.id, assertUuid(id, 'id')));
  return row ? shape(row) : null;
}

export async function listConversations(
  tx: TenantTx,
  q: ConversationListQuery,
): Promise<Page<ConversationView>> {
  assertLimit(q.limit);
  const c = conversations;
  const where: (SQL | undefined)[] = [];
  if (q.workspaceId !== undefined)
    where.push(eq(c.workspaceId, assertUuid(q.workspaceId, 'workspaceId')));
  if (q.states !== undefined) where.push(inArray(c.state, [...q.states]));
  if (q.afterHoursHold !== undefined) where.push(eq(c.afterHoursHold, q.afterHoursHold));
  if (q.assigned === 'none') where.push(isNull(c.assignedUserId));
  else if (q.assigned) where.push(eq(c.assignedUserId, assertUuid(q.assigned.userId, 'assigned')));
  if (q.mineOrUnassigned !== undefined) {
    const me = assertUuid(q.mineOrUnassigned, 'mineOrUnassigned');
    where.push(or(eq(c.assignedUserId, me), isNull(c.assignedUserId)));
  }
  if (q.channelAccountId !== undefined)
    where.push(eq(c.channelAccountId, assertUuid(q.channelAccountId, 'channelAccountId')));
  if (q.customer !== undefined)
    where.push(isNull(customers.deletedAt), customerSearchWhere(q.customer));
  // Every filter sits in the same WHERE as the keyset below, joined by AND: they narrow before the page is cut, never after it.
  if (q.cursor !== undefined) {
    const fields = decodeCursor(q.cursor);
    const at = cursorString(fields, 'at', SORT_FORMAT);
    const id = cursorString(fields, 'id', UUID_FORMAT);
    where.push(sql`(${SORT_KEY}, ${c.id}) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = await tx
    .select({ ...view, sortKey: SORT_TEXT })
    .from(c)
    .leftJoin(customers, withCustomer)
    .leftJoin(channelAccounts, withChannel)
    .where(and(...where))
    .orderBy(sql`${SORT_KEY} DESC`, desc(c.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    rows: page.map(withoutSortKey),
    nextCursor:
      rows.length > q.limit && last ? encodeCursor({ at: last.sortKey, id: last.id }) : null,
  };
}

export interface MessageView {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly senderKind: string;
  readonly senderUserId: string | null;
  readonly kind: string;
  readonly body: string | null;
  readonly platformSentAt: Date | null;
  readonly createdAt: Date;
}

const MESSAGE_COLUMNS = {
  id: messages.id,
  sequenceNumber: messages.sequenceNumber,
  senderKind: messages.senderKind,
  senderUserId: messages.senderUserId,
  kind: messages.kind,
  body: messages.body,
  platformSentAt: messages.platformSentAt,
  createdAt: messages.createdAt,
};

/** A message as the Inbox lists it: with the delivery of a message the account sent to the channel (N146), null for the others. */
export type ListedMessage = MessageView & {
  readonly deliveryStatus: 'pending' | 'sent' | 'failed' | null;
};

/**
 * The messages of a conversation, newest first (a chat loads the latest and pages back), by `sequence_number`. The caller first
 * makes sure the conversation is visible (loadConversationView); RLS limits the messages to the session's workspaces anyway.
 */
export async function listMessages(
  tx: TenantTx,
  conversationId: string,
  q: { readonly cursor?: string; readonly limit: number },
): Promise<Page<ListedMessage>> {
  assertLimit(q.limit);
  const m = messages;
  const where: SQL[] = [eq(m.conversationId, assertUuid(conversationId, 'conversationId'))];
  if (q.cursor !== undefined)
    where.push(lt(m.sequenceNumber, cursorWhole(decodeCursor(q.cursor), 'before')));
  const d = messageDeliveries;
  const rows = await tx
    .select({ ...MESSAGE_COLUMNS, deliveryStatus: d.status })
    .from(m)
    .leftJoin(d, and(eq(d.orgId, m.orgId), eq(d.messageId, m.id)))
    .where(and(...where))
    .orderBy(desc(m.sequenceNumber))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      rows.length > q.limit && last ? encodeCursor({ before: last.sequenceNumber }) : null,
  };
}

/** At most this many messages in one answer of `resume` (realtime spec §5). */
export const RESUME_PAGE_MAX = 200;

/**
 * For `resume` (realtime spec §5): the messages after `after`, oldest first, at most `limit`, and the highest number the conversation
 * has. The highest is read first: a message that commits between the two reads can be in the page with a number above it, never be
 * missed (the client drops what it already has by `sequenceNumber`). The caller first makes sure the conversation is visible.
 */
export async function listMessagesAfter(
  tx: TenantTx,
  conversationId: string,
  q: { readonly after: number; readonly limit: number },
): Promise<{
  readonly rows: readonly MessageView[];
  readonly hasMore: boolean;
  readonly maxSequence: number;
}> {
  if (!Number.isSafeInteger(q.after) || q.after < 0)
    throw new RangeError('after must be a whole number >= 0');
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > RESUME_PAGE_MAX)
    throw new RangeError(`limit must be 1..${RESUME_PAGE_MAX}`);
  const m = messages;
  const id = assertUuid(conversationId, 'conversationId');
  const [top] = await tx
    .select({ max: sql<number>`coalesce(max(${m.sequenceNumber}), 0)::int` })
    .from(m)
    .where(eq(m.conversationId, id));
  const rows = await tx
    .select(MESSAGE_COLUMNS)
    .from(m)
    .where(and(eq(m.conversationId, id), gt(m.sequenceNumber, q.after)))
    .orderBy(asc(m.sequenceNumber))
    .limit(q.limit + 1);
  return {
    rows: rows.slice(0, q.limit),
    hasMore: rows.length > q.limit,
    maxSequence: top?.max ?? 0,
  };
}

/**
 * One message as the realtime emitter sends it to the room of its conversation (realtime spec §3), read under RLS when it is sent:
 * the outbox carries its ids only. `null` when it does not exist or RLS hides it.
 */
export async function loadMessageView(
  tx: TenantTx,
  id: string,
): Promise<(MessageView & { readonly conversationId: string }) | null> {
  const [row] = await tx
    .select({ ...MESSAGE_COLUMNS, conversationId: messages.conversationId })
    .from(messages)
    .where(eq(messages.id, assertUuid(id, 'messageId')))
    .limit(1);
  return row ?? null;
}
