import type { TicketNames, TicketRow } from '@gani/db';

/** 422 of an assignee who is not an active Owner, Admin, Manager or Support of the workspace (U52): one answer for every reason. */
export class TicketAssigneeHttpError extends Error {
  readonly status = 422;
  readonly code = 'invalid_assignee';
  constructor() {
    super('This person cannot receive a ticket of this workspace.');
    this.name = 'TicketAssigneeHttpError';
  }
}

/** A ticket as the API answers it (TicketSchema), with the names of `names` (ticketNames). */
export const ticketView = (row: TicketRow, names: TicketNames) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  title: row.title,
  description: row.description,
  status: row.status,
  priority: row.priority,
  type: row.type,
  customer:
    row.customerId === null
      ? null
      : { id: row.customerId, displayName: names.customers.get(row.customerId) ?? null },
  conversationId: row.conversationId,
  assignee:
    row.assigneeUserId === null
      ? null
      : { id: row.assigneeUserId, name: names.people.get(row.assigneeUserId) ?? null },
  // The SLA columns wait for Q7 and Q8: nothing writes them yet, so this is null until then.
  sla:
    row.slaDueAt === null
      ? null
      : { dueAt: row.slaDueAt.toISOString(), pausedReason: row.slaPausedReason },
  version: row.version,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
