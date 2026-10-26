// #14/#15 Ticket for the e2e stub API only, as planned (docs/openapi/planned.json, N167): `GET /v1/tickets`, the workspace's
// tickets, newest first, by cursor, filtered by status and assignee; Sales see the ones they made; `GET /v1/tickets/{id}` with its
// events and `PATCH` of the status (the moves of N167, cancelling for Owner/Admin/Manager; each session changes its own copy,
// `+stale@` gets version_conflict); `POST` makes one (#15(b): Phụ lục B "Ticket: tạo", an assignee among Owner/Admin/Manager/Support
// of U52, `+bad-assignee@` gets 422 invalid_assignee; from a conversation it keeps `conversationId` and the customer, #358). `+no-tickets@` gets the 404 of an API that does not serve the routes yet.
// Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import { NEXT, type TicketDetail, type TicketEvent } from '../src/tickets/ticket-detail';
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

const created = (t: Ticket): TicketEvent => ({
  type: 'created',
  fromStatus: null,
  toStatus: null,
  actorUserId: t.createdBy,
  occurredAt: t.createdAt,
});
/** Each session's tickets with their history, as it changed them. */
const edited = new Map<string, Map<string, TicketDetail>>();
/** The tickets each session made, newest first. */
const made = new Map<string, Ticket[]>();
const ASSIGNEES = ['owner', 'admin', 'manager', 'support'];
const LEADS = ['owner', 'admin', 'manager'];
/** A ticket of the list, which has no history. */
function withoutEvents(t: TicketDetail): Ticket {
  const copy: Partial<TicketDetail> = { ...t };
  delete copy.events;
  return copy as Ticket;
}

/** Answers a route of /v1/tickets and says true, or says false for any other route. `session` is null when signed out. */
export async function routeTickets(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: {
    readonly sid: string;
    readonly role: string | undefined;
    readonly email: string;
  } | null,
  edge: Edge,
): Promise<boolean> {
  if (!path.startsWith('/v1/tickets')) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.email.includes('+no-tickets@'))
    return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const me = `user-${session.role ?? ''}`;
  const mine = edited.get(session.sid) ?? new Map<string, TicketDetail>();
  const tickets: TicketDetail[] = [...(made.get(session.sid) ?? []), ...TICKETS].map(
    (t) => mine.get(t.id) ?? { ...t, events: [created(t)] },
  );
  const seen = tickets.filter((t) => session.role !== 'sales' || t.createdBy === me);
  if (req.method === 'POST' && path === '/v1/tickets') {
    if (!['sales', 'support', ...LEADS].includes(session.role ?? ''))
      return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
    const body = await edge.json(req);
    const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
    const to = body['assigneeUserId'];
    if (!req.headers['idempotency-key'] || !title || title.length > 200)
      return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
    if (
      session.email.includes('+bad-assignee@') ||
      (to !== undefined && !ASSIGNEES.some((r) => to === `user-${r}`))
    )
      return (edge.problem(res, 422, 'invalid_assignee', 'trace-e2e-422'), true);
    // From a conversation (#358): its customer, if any, must be one the stub knows (else 404 like the API); null is refused.
    const customerId = body['customerId'];
    const customer = CUSTOMERS.find((c) => c.id === customerId);
    if (customerId !== undefined && !customer)
      return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    const now = new Date().toISOString();
    const t: Ticket = {
      ...TICKETS[0]!,
      id: `0190c3ff-0000-7000-8000-${String(Date.now()).padStart(12, '0').slice(-12)}`,
      title,
      description: typeof body['description'] === 'string' ? body['description'] : null,
      status: 'new',
      priority: (body['priority'] as Ticket['priority'] | undefined) ?? 'normal',
      customer: customer ? { id: customer.id, displayName: customer.displayName } : null,
      conversationId: typeof body['conversationId'] === 'string' ? body['conversationId'] : null,
      assignee: typeof to === 'string' ? { id: to, name: `Người thử ${to.slice(5)}` } : null,
      version: 0,
      createdBy: me,
      createdAt: now,
      updatedAt: now,
    };
    made.set(session.sid, [t, ...(made.get(session.sid) ?? [])]);
    return (edge.send(res, 201, { ...t, events: [created(t)] }), true);
  }
  const one = /^\/v1\/tickets\/([^/]+)$/.exec(path);
  if (one) {
    const t = seen.find((x) => x.id === decodeURIComponent(one[1] ?? ''));
    if (req.method === 'GET')
      return (
        t ? edge.send(res, 200, t) : edge.problem(res, 404, 'not_found', 'trace-e2e-404'),
        true
      );
    if (req.method !== 'PATCH') return false;
    // "Ticket: đổi trạng thái" (Phụ lục B): not Sales; cancelling is Owner/Admin/Manager only.
    if (!['support', ...LEADS].includes(session.role ?? ''))
      return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
    if (!t) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    const { version, status } = await edge.json(req);
    if (version !== t.version || session.email.includes('+stale@'))
      return (edge.problem(res, 409, 'version_conflict', 'trace-e2e-409'), true);
    const to = status as Ticket['status'];
    if (to === 'cancelled' && !LEADS.includes(session.role ?? ''))
      return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
    if (!NEXT[t.status].includes(to))
      return (edge.problem(res, 409, 'invalid_transition', 'trace-e2e-409'), true);
    const now = new Date().toISOString();
    const event: TicketEvent = {
      type: 'status_changed',
      fromStatus: t.status,
      toStatus: to,
      actorUserId: me,
      occurredAt: now,
    };
    const next = {
      ...t,
      status: to,
      version: t.version + 1,
      updatedAt: now,
      events: [...t.events, event],
    };
    edited.set(session.sid, mine.set(t.id, next));
    return (edge.send(res, 200, next), true);
  }
  if (req.method !== 'GET' || path !== '/v1/tickets') return false;
  const q = new URL(req.url ?? '/', 'http://stub').searchParams;
  const status = q.get('status');
  const assignee = q.get('assignee');
  const found = seen.filter(
    (t) =>
      (!status || t.status === status) &&
      (assignee === 'me' ? t.assignee?.id === me : assignee === 'none' ? !t.assignee : true),
  );
  const from = Number(q.get('cursor') ?? 0);
  const next = from + TICKETS_PAGE < found.length ? String(from + TICKETS_PAGE) : null;
  edge.send(res, 200, {
    data: found.slice(from, from + TICKETS_PAGE).map(withoutEvents),
    nextCursor: next,
  });
  return true;
}
