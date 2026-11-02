import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import type { Page } from './conversation-read.js';
import { cursorString, decodeCursor, encodeCursor } from './cursor.js';
import { customers } from './schema/customers.js';
import { ticketEvents, tickets } from './schema/tickets.js';
import type { TenantTx } from './tenant-tx.js';
import {
  ticketColumns,
  TICKET_STATUSES,
  type TicketRow,
  type TicketStatus,
} from './ticket-store.js';
import { assertUuid } from './validate.js';

// Reading the tickets of the transaction's workspaces (K1b-3, U27, U53, N167, N170): a page of them, newest first, and one with what
// happened to it. Row-level security keeps every other workspace and organisation out; which of them a person reads (a Sales reads the
// ones they made, Phụ lục B "Ticket: tạo") is the `createdBy` the caller passes.

/** The most tickets one read gives (GET /v1/tickets). */
export const TICKET_MAX_LIMIT = 100;

// The key as text with microseconds, as audit-log-read.ts: a Date would round it and a page could repeat or skip a ticket.
const SORT_TEXT = sql<string>`to_char(${tickets.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const SORT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface TicketQuery {
  /** One of the transaction's workspaces; absent: all of them. */
  readonly workspaceId?: string;
  readonly status?: TicketStatus;
  /** `none` (nobody), or the id of a member (the API turns `me` into the caller's id). */
  readonly assignee?: string;
  /** The tickets of one conversation (U53). */
  readonly conversationId?: string;
  /** Only the tickets this person made: a Sales reads no other (N170). */
  readonly createdBy?: string;
  /** 1..TICKET_MAX_LIMIT. */
  readonly limit: number;
  /** The `nextCursor` of the page before, read with the same filters. */
  readonly cursor?: string;
}

/** A page of tickets, newest first (`id` breaking ties). A wrong filter throws before any query; a foreign cursor InvalidCursorError. */
export async function listTickets(tx: TenantTx, q: TicketQuery): Promise<Page<TicketRow>> {
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > TICKET_MAX_LIMIT)
    throw new RangeError(`limit must be a whole number between 1 and ${TICKET_MAX_LIMIT}`);
  if (q.status !== undefined && !(TICKET_STATUSES as readonly string[]).includes(q.status))
    throw new RangeError('status is not one of a ticket');
  const where: SQL[] = [];
  if (q.workspaceId !== undefined)
    where.push(eq(tickets.workspaceId, assertUuid(q.workspaceId, 'workspaceId')));
  if (q.status !== undefined) where.push(eq(tickets.status, q.status));
  if (q.assignee === 'none') where.push(isNull(tickets.assigneeUserId));
  else if (q.assignee !== undefined)
    where.push(eq(tickets.assigneeUserId, assertUuid(q.assignee, 'assignee')));
  if (q.conversationId !== undefined)
    where.push(eq(tickets.conversationId, assertUuid(q.conversationId, 'conversationId')));
  if (q.createdBy !== undefined)
    where.push(eq(tickets.createdBy, assertUuid(q.createdBy, 'createdBy')));
  if (q.cursor !== undefined) {
    const fields = decodeCursor(q.cursor);
    const at = cursorString(fields, 'at', SORT_FORMAT);
    const id = cursorString(fields, 'id', UUID_FORMAT);
    where.push(sql`(${tickets.createdAt}, ${tickets.id}) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = await tx
    .select({ ...ticketColumns, sortKey: SORT_TEXT })
    .from(tickets)
    .where(and(...where))
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    rows: page.map(({ sortKey, ...row }) => {
      void sortKey;
      return row as TicketRow;
    }),
    nextCursor:
      rows.length > q.limit && last ? encodeCursor({ at: last.sortKey, id: last.id }) : null,
  };
}

export interface TicketEventRow {
  readonly type: 'created' | 'status_changed' | 'assigned' | 'edited';
  readonly fromStatus: TicketStatus | null;
  readonly toStatus: TicketStatus | null;
  readonly actorUserId: string | null;
  readonly occurredAt: Date;
}

/** The ticket `id` with its events, oldest first; null when the transaction's workspaces do not hold it. */
export async function loadTicket(
  tx: TenantTx,
  id: string,
): Promise<(TicketRow & { readonly events: readonly TicketEventRow[] }) | null> {
  const ticketId = assertUuid(id, 'id');
  const [row] = await tx.select(ticketColumns).from(tickets).where(eq(tickets.id, ticketId));
  if (!row) return null;
  const events = await tx
    .select({
      type: ticketEvents.type,
      fromStatus: ticketEvents.fromStatus,
      toStatus: ticketEvents.toStatus,
      actorUserId: ticketEvents.actorUserId,
      occurredAt: ticketEvents.occurredAt,
    })
    .from(ticketEvents)
    .where(eq(ticketEvents.ticketId, ticketId))
    .orderBy(asc(ticketEvents.occurredAt), asc(ticketEvents.id));
  return { ...(row as TicketRow), events: events as TicketEventRow[] };
}

/** The names a ticket is shown with: by customer id and by person id. A name nobody gave, or that is no longer visible, is null. */
export interface TicketNames {
  readonly customers: ReadonlyMap<string, string | null>;
  readonly people: ReadonlyMap<string, string | null>;
}

/**
 * The names of the customers and assignees of `rows` (K1c-1): a customer's from customers (a deleted one has none), a person's only
 * through app.org_users (active members, no email), so an assignee who left keeps their id with no name, as a conversation's holder.
 */
export async function ticketNames(
  tx: TenantTx,
  rows: readonly Pick<TicketRow, 'customerId' | 'assigneeUserId'>[],
): Promise<TicketNames> {
  const ids = (pick: (r: (typeof rows)[number]) => string | null) => [
    ...new Set(rows.map(pick).filter((id): id is string => id !== null)),
  ];
  const [customerIds, personIds] = [ids((r) => r.customerId), ids((r) => r.assigneeUserId)];
  const named =
    customerIds.length === 0
      ? []
      : await tx
          .select({ id: customers.id, name: customers.displayName })
          .from(customers)
          .where(and(inArray(customers.id, customerIds), isNull(customers.deletedAt)));
  const people =
    personIds.length === 0
      ? []
      : (
          await tx.execute<{ id: string; name: string | null }>(sql`
            SELECT user_id AS id, nullif(btrim(display_name), '') AS name FROM app.org_users
            WHERE user_id = ANY(${`{${personIds.join(',')}}`}::uuid[])`)
        ).rows;
  return {
    customers: new Map(named.map((c) => [c.id, c.name])),
    people: new Map(people.map((p) => [p.id, p.name])),
  };
}
