import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import { cursorString, cursorWhole, decodeCursor, encodeCursor } from './cursor.js';
import { conversations } from './schema/conversations.js';
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
};

const withoutSortKey = (row: ConversationView & { readonly sortKey: string }): ConversationView => {
  const { sortKey, ...rest } = row;
  void sortKey;
  return rest;
};

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
    .where(eq(conversations.id, assertUuid(id, 'id')));
  return row ?? null;
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
  if (q.cursor !== undefined) {
    const fields = decodeCursor(q.cursor);
    const at = cursorString(fields, 'at', SORT_FORMAT);
    const id = cursorString(fields, 'id', UUID_FORMAT);
    where.push(sql`(${SORT_KEY}, ${c.id}) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = await tx
    .select({ ...view, sortKey: SORT_TEXT })
    .from(c)
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

/**
 * The messages of a conversation, newest first (a chat loads the latest and pages back), by `sequence_number`. The caller first
 * makes sure the conversation is visible (loadConversationView); RLS limits the messages to the session's workspaces anyway.
 */
export async function listMessages(
  tx: TenantTx,
  conversationId: string,
  q: { readonly cursor?: string; readonly limit: number },
): Promise<Page<MessageView>> {
  assertLimit(q.limit);
  const m = messages;
  const where: SQL[] = [eq(m.conversationId, assertUuid(conversationId, 'conversationId'))];
  if (q.cursor !== undefined)
    where.push(lt(m.sequenceNumber, cursorWhole(decodeCursor(q.cursor), 'before')));
  const rows = await tx
    .select(MESSAGE_COLUMNS)
    .from(m)
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
