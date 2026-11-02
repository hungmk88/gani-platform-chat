import type { TicketRow } from '@gani/db';
import { describe, expect, it } from 'vitest';

import { mayUseTickets, readsOwnTicketsOnly } from './tickets.permissions.js';
import { TicketAssigneeHttpError, ticketView } from './tickets.view.js';

// What the integration test (tickets.integration.test.ts) cannot reach yet: an SLA, which nothing writes before Q7 and Q8.
describe('tickets view and permissions', () => {
  it('gives the SLA when the ticket has one, and the id of an assignee with no name', () => {
    const at = new Date('2026-11-02T03:04:05.678Z');
    const row = {
      slaDueAt: at,
      slaPausedReason: 'outside_hours',
      assigneeUserId: 'p',
      customerId: null,
    };
    const view = ticketView({ ...row, createdAt: at, updatedAt: at } as TicketRow, {
      customers: new Map(),
      people: new Map(),
    });
    expect(view).toMatchObject({
      sla: { dueAt: '2026-11-02T03:04:05.678Z', pausedReason: 'outside_hours' },
      assignee: { id: 'p', name: null },
      customer: null,
    });
  });

  it('lets the five roles of "Ticket: tạo" use tickets, a Sales only their own; 422 invalid_assignee', () => {
    const roles = ['owner', 'admin', 'manager', 'sales', 'support', 'marketing', 'viewer'] as const;
    expect(roles.filter(mayUseTickets)).toEqual(['owner', 'admin', 'manager', 'sales', 'support']);
    expect(roles.filter(readsOwnTicketsOnly)).toEqual(['sales']);
    expect(new TicketAssigneeHttpError()).toMatchObject({ status: 422, code: 'invalid_assignee' });
  });
});
