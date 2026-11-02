import { and, eq, sql } from 'drizzle-orm';

import { ticketEvents, tickets } from './schema/tickets.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The tickets of a workspace (K1b, U27, N167, N170): making one and changing it, each with its line in ticket_events, in the caller's
// tenant transaction. Row-level security keeps them to the organisation and the workspaces of the transaction; who may make or change
// a ticket at all (Phụ lục B) is the caller's check, the rules of the ticket itself are here: the moves between states, who may cancel,
// who may receive a ticket, and the version a change was read at. There is no claim: two changes at once are kept apart by the version.

/** The five states of a ticket (U27, CEO 26/10/2026). */
export const TICKET_STATUSES = [
  'new',
  'in_progress',
  'waiting_customer',
  'done',
  'cancelled',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Where a ticket may go from each state (N167). `done` may be reopened; `cancelled` is final. */
export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  new: ['in_progress', 'cancelled'],
  in_progress: ['waiting_customer', 'done', 'cancelled'],
  waiting_customer: ['in_progress', 'done', 'cancelled'],
  done: ['in_progress'],
  cancelled: [],
};

export const TICKET_PRIORITIES = ['normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** Who may receive a ticket (U52, N170): an Owner, Admin, Manager or Support of the ticket's workspace. */
export const TICKET_HANDLER_ROLES = ['owner', 'admin', 'manager', 'support'] as const;
/** Who may cancel one (U27). */
export const TICKET_CANCEL_ROLES = ['owner', 'admin', 'manager'] as const;

export class TicketNotFoundError extends Error {
  constructor() {
    super('no ticket with this id in the transaction’s workspaces');
    this.name = 'TicketNotFoundError';
  }
}

/** The ticket changed since the version the caller read (409 version_conflict). */
export class TicketVersionConflictError extends Error {
  constructor() {
    super('the ticket changed since it was read');
    this.name = 'TicketVersionConflictError';
  }
}

/** This state cannot follow the current one (409 invalid_transition). */
export class InvalidTicketTransitionError extends Error {
  constructor(
    readonly from: TicketStatus,
    readonly to: TicketStatus,
  ) {
    super(`a ticket cannot go from ${from} to ${to}`);
    this.name = 'InvalidTicketTransitionError';
  }
}

/** Only an Owner, an Admin or a Manager cancels a ticket (403). */
export class TicketCancelForbiddenError extends Error {
  constructor() {
    super('only an Owner, an Admin or a Manager cancels a ticket');
    this.name = 'TicketCancelForbiddenError';
  }
}

/** Not an active Owner, Admin, Manager or Support of the ticket's workspace (422 invalid_assignee). */
export class InvalidTicketAssigneeError extends Error {
  constructor() {
    super('this person cannot receive a ticket of this workspace');
    this.name = 'InvalidTicketAssigneeError';
  }
}

/** The customer or the conversation is not one of the organisation, or the conversation not one of the workspace (404). */
export class TicketReferenceNotFoundError extends Error {
  constructor() {
    super('the customer or the conversation of the ticket is not there');
    this.name = 'TicketReferenceNotFoundError';
  }
}

export interface TicketRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly type: string | null;
  readonly customerId: string | null;
  readonly conversationId: string | null;
  readonly assigneeUserId: string | null;
  readonly createdBy: string;
  readonly slaDueAt: Date | null;
  readonly slaPausedReason: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const ticketColumns = {
  id: tickets.id,
  workspaceId: tickets.workspaceId,
  title: tickets.title,
  description: tickets.description,
  status: tickets.status,
  priority: tickets.priority,
  type: tickets.type,
  customerId: tickets.customerId,
  conversationId: tickets.conversationId,
  assigneeUserId: tickets.assigneeUserId,
  createdBy: tickets.createdBy,
  slaDueAt: tickets.slaDueAt,
  slaPausedReason: tickets.slaPausedReason,
  version: tickets.version,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
};

/** Throws InvalidTicketAssigneeError unless `userId` is an active Owner, Admin, Manager or Support, member of the live workspace. */
async function assertHandler(tx: TenantTx, workspaceId: string, userId: string): Promise<void> {
  const { rows } = await tx.execute(sql`
    SELECT 1 FROM app.org_users u
    JOIN public.workspace_members wm ON wm.org_id = u.org_id AND wm.user_id = u.user_id
      AND wm.workspace_id = ${workspaceId}::uuid AND wm.deleted_at IS NULL
    JOIN public.workspaces w ON w.org_id = wm.org_id AND w.id = wm.workspace_id AND w.deleted_at IS NULL
    WHERE u.user_id = ${assertUuid(userId, 'assigneeUserId')}::uuid
      AND u.role = ANY(${`{${TICKET_HANDLER_ROLES.join(',')}}`}::text[])`);
  if (rows.length === 0) throw new InvalidTicketAssigneeError();
}

/** Runs `fn` in a savepoint and turns a missing customer or conversation (23503 on their keys) into TicketReferenceNotFoundError. */
async function referencesThere<T>(tx: TenantTx, fn: (t: TenantTx) => Promise<T>): Promise<T> {
  try {
    return await tx.transaction(fn);
  } catch (error) {
    for (let e: unknown = error; e instanceof Error; e = e.cause) {
      const { code, constraint } = e as { code?: unknown; constraint?: unknown };
      if (
        code === '23503' &&
        (constraint === 'tickets_customer_fk' || constraint === 'tickets_conversation_fk')
      )
        throw new TicketReferenceNotFoundError();
    }
    throw error;
  }
}

export interface TicketCreate {
  readonly workspaceId: string;
  readonly title: string;
  readonly description?: string;
  readonly priority?: TicketPriority;
  readonly customerId?: string;
  readonly conversationId?: string;
  readonly assigneeUserId?: string;
  readonly createdBy: string;
  readonly newId: () => string;
}

/** Makes a ticket in state `new`, with its `created` event, and gives it back. */
export async function createTicket(tx: TenantTx, input: TicketCreate): Promise<TicketRow> {
  const workspaceId = assertUuid(input.workspaceId, 'workspaceId');
  const createdBy = assertUuid(input.createdBy, 'createdBy');
  if (input.assigneeUserId !== undefined)
    await assertHandler(tx, workspaceId, input.assigneeUserId);
  const { orgId } = currentTenantContext();
  const [row] = await referencesThere(tx, (t) =>
    t
      .insert(tickets)
      .values({
        id: input.newId(),
        orgId,
        workspaceId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'normal',
        customerId:
          input.customerId === undefined ? null : assertUuid(input.customerId, 'customerId'),
        conversationId:
          input.conversationId === undefined
            ? null
            : assertUuid(input.conversationId, 'conversationId'),
        assigneeUserId: input.assigneeUserId ?? null,
        createdBy,
      })
      .returning(ticketColumns),
  );
  const ticket = row as TicketRow;
  await tx.insert(ticketEvents).values({
    id: input.newId(),
    orgId,
    workspaceId,
    ticketId: ticket.id,
    type: 'created',
    toStatus: 'new',
    actorUserId: createdBy,
  });
  return ticket;
}

/** What a change may set; `null` clears the description or the assignee. */
export interface TicketChange {
  readonly status?: TicketStatus;
  readonly title?: string;
  readonly description?: string | null;
  readonly priority?: TicketPriority;
  readonly assigneeUserId?: string | null;
}

/**
 * Changes the ticket `id` read at `version`, under a lock of the row: the moves of TICKET_TRANSITIONS only, `cancelled` only by an
 * Owner, Admin or Manager (`actorRole`), the assignee a handler of the workspace. One event per kind of change: `status_changed`,
 * `assigned`, `edited` (title, description, priority). Gives the ticket back with its new version.
 */
export async function changeTicket(
  tx: TenantTx,
  input: {
    readonly id: string;
    readonly version: number;
    readonly change: TicketChange;
    readonly actorUserId: string;
    readonly actorRole: string;
    readonly newId: () => string;
  },
): Promise<TicketRow> {
  const id = assertUuid(input.id, 'id');
  const actor = assertUuid(input.actorUserId, 'actorUserId');
  const [current] = await tx
    .select(ticketColumns)
    .from(tickets)
    .where(eq(tickets.id, id))
    .for('update');
  if (!current) throw new TicketNotFoundError();
  const ticket = current as TicketRow;
  if (ticket.version !== input.version) throw new TicketVersionConflictError();
  const { change } = input;
  const moves = change.status !== undefined && change.status !== ticket.status;
  if (moves) {
    const to = change.status;
    if (!TICKET_TRANSITIONS[ticket.status].includes(to))
      throw new InvalidTicketTransitionError(ticket.status, to);
    if (to === 'cancelled' && !(TICKET_CANCEL_ROLES as readonly string[]).includes(input.actorRole))
      throw new TicketCancelForbiddenError();
  }
  const reassigned =
    change.assigneeUserId !== undefined && change.assigneeUserId !== ticket.assigneeUserId;
  if (reassigned && change.assigneeUserId !== null)
    await assertHandler(tx, ticket.workspaceId, change.assigneeUserId);
  const edited =
    (change.title !== undefined && change.title !== ticket.title) ||
    (change.description !== undefined && change.description !== ticket.description) ||
    (change.priority !== undefined && change.priority !== ticket.priority);
  const [row] = await tx
    .update(tickets)
    .set({
      ...(change.status !== undefined && { status: change.status }),
      ...(change.title !== undefined && { title: change.title }),
      ...(change.description !== undefined && { description: change.description }),
      ...(change.priority !== undefined && { priority: change.priority }),
      ...(change.assigneeUserId !== undefined && { assigneeUserId: change.assigneeUserId }),
      version: sql`${tickets.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(tickets.id, id), eq(tickets.version, input.version)))
    .returning(ticketColumns);
  // The row is locked above, so this is a second guard: an update that finds no row at the version read is a conflict, never a quiet
  // success.
  if (!row) throw new TicketVersionConflictError();
  const base = {
    orgId: currentTenantContext().orgId,
    workspaceId: ticket.workspaceId,
    ticketId: id,
    actorUserId: actor,
  };
  const events = [
    ...(moves
      ? [{ type: 'status_changed', fromStatus: ticket.status, toStatus: change.status }]
      : []),
    ...(reassigned ? [{ type: 'assigned' }] : []),
    ...(edited ? [{ type: 'edited' }] : []),
  ];
  if (events.length > 0)
    await tx.insert(ticketEvents).values(events.map((e) => ({ ...base, ...e, id: input.newId() })));
  return row as TicketRow;
}
