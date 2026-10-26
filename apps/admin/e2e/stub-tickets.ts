// #14 Ticket for the e2e stub API only: `GET /v1/tickets` as planned (docs/openapi/planned.json, N167): the workspace's tickets,
// newest first, by cursor, filtered by status and assignee; Sales see the ones they made; `+no-tickets@` gets the 404 of an API that
// does not serve the route yet. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Ticket } from '../src/tickets/tickets';
import { CUSTOMERS } from './stub-customers';
import type { Edge } from './stub-members';

const at = (day: number) => `2026-10-2${day}T03:00:00.000Z`;
const ticket = (
  n: number,
  title: string,
  status: Ticket['status'],
  assignee: string | null,
  createdBy: string,
  extra: Partial<Ticket> = {},
): Ticket => ({
  id: `0190c300-0000-7000-8000-00000000000${n}`,
  workspaceId: 'ws-e2e',
  title,
  description: null,
  status,
  priority: 'normal',
  type: null,
  customer: null,
  conversationId: null,
  assignee: assignee ? { id: `user-${assignee}`, name: `Người thử ${assignee}` } : null,
  sla: null,
  version: 1,
  createdBy: `user-${createdBy}`,
  createdAt: at(6 - n),
  updatedAt: at(6 - n),
  ...extra,
});

/** The tickets of the stub's workspace, newest first. */
export const TICKETS: Ticket[] = [
  ticket(1, 'Đổi lịch giao hàng', 'new', null, 'sales', {
    priority: 'urgent',
    customer: { id: CUSTOMERS[0]!.id, displayName: CUSTOMERS[0]!.displayName },
  }),
  ticket(2, 'Bổ sung hóa đơn tháng 9', 'in_progress', 'support', 'sales', {
    sla: { dueAt: '2026-10-26T03:00:00.000Z', pausedReason: null },
  }),
  ticket(3, 'Xin lịch hẹn tư vấn', 'waiting_customer', 'manager', 'manager', {
    sla: { dueAt: '2026-10-26T03:00:00.000Z', pausedReason: 'waiting_customer' },
  }),
  ticket(4, 'Cập nhật địa chỉ công ty', 'done', 'support', 'support'),
];
/** The page size of the stub's list, small so that "Tải thêm" is tested. */
export const TICKETS_PAGE = 3;

/** Answers GET /v1/tickets and says true, or says false for any other route. `session` is null when signed out. */
export function routeTickets(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined; readonly email: string } | null,
  edge: Edge,
): boolean {
  if (req.method !== 'GET' || path !== '/v1/tickets') return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.email.includes('+no-tickets@'))
    return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const q = new URL(req.url ?? '/', 'http://stub').searchParams;
  const me = `user-${session.role ?? ''}`;
  const status = q.get('status');
  const assignee = q.get('assignee');
  const found = TICKETS.filter(
    (t) =>
      (session.role !== 'sales' || t.createdBy === me) &&
      (!status || t.status === status) &&
      (assignee === 'me' ? t.assignee?.id === me : assignee === 'none' ? !t.assignee : true),
  );
  const from = Number(q.get('cursor') ?? 0);
  const next = from + TICKETS_PAGE < found.length ? String(from + TICKETS_PAGE) : null;
  edge.send(res, 200, { data: found.slice(from, from + TICKETS_PAGE), nextCursor: next });
  return true;
}
