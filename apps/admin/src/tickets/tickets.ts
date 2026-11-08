// #14 Ticket (U27, N167): the tickets of the workspace being worked in from `GET /v1/tickets`, the real API since K1c-1 (#538,
// openapi.json). A 404 (an API without the route) still shows the screen not there yet.
import type { components } from '../api/schema';

export type Ticket = components['schemas']['Ticket'];
export type TicketPage = components['schemas']['TicketPage'];
export type TicketStatus = Ticket['status'];

/** The five states of U27 in words, with the colour of the open ones (CLAUDE.md: green/yellow/red only for states). */
export const STATUS: Readonly<Record<TicketStatus, readonly [string, 'ok' | 'warn' | null]>> = {
  new: ['Mới', 'warn'],
  in_progress: ['Đang xử lý', 'ok'],
  waiting_customer: ['Chờ khách', null],
  done: ['Đã xong', null],
  cancelled: ['Đã hủy', null],
};

export const PRIORITY: Readonly<Record<Ticket['priority'], string>> = {
  normal: 'Thường',
  high: 'Cao',
  urgent: 'Khẩn',
};

export type AssigneeFilter = 'any' | 'me' | 'none';
export interface TicketFilter {
  readonly status: TicketStatus | 'all';
  readonly assignee: AssigneeFilter;
}

/** `GET /v1/tickets` of the workspace, newest first, by cursor; `any` is no assignee filter. */
export function ticketsPath(workspaceId: string, f: TicketFilter, cursor: string | null): string {
  const p = new URLSearchParams({ workspaceId, limit: '50' });
  if (f.status !== 'all') p.set('status', f.status);
  if (f.assignee !== 'any') p.set('assignee', f.assignee);
  if (cursor) p.set('cursor', cursor);
  return `/v1/tickets?${p.toString()}`;
}

/** `GET /v1/tickets?conversationId=`: the tickets made from one conversation, newest first, by cursor (U53, N170; CEO brief 171 B8). */
export function conversationTicketsPath(conversationId: string, cursor: string | null): string {
  const p = new URLSearchParams({ conversationId, limit: '50' });
  if (cursor) p.set('cursor', cursor);
  return `/v1/tickets?${p.toString()}`;
}

/** Roles that work with tickets (Phụ lục B, the menu): Owner, Admin, Manager, Sales (makes them), Support. */
export const mayReadTickets = (role: string | null): boolean =>
  role === 'owner' ||
  role === 'admin' ||
  role === 'manager' ||
  role === 'sales' ||
  role === 'support';

const TIME = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/** The SLA of an open ticket in words: none yet (null until Q7/Q8), paused, or its due time. */
export function slaText(t: Pick<Ticket, 'sla' | 'status'>): string {
  if (t.status === 'done' || t.status === 'cancelled') return '—';
  if (!t.sla) return 'Chưa có SLA';
  if (t.sla.pausedReason === 'waiting_customer') return 'Tạm dừng: chờ khách';
  if (t.sla.pausedReason === 'outside_hours') return 'Tạm dừng: ngoài giờ';
  return `Hạn ${TIME.format(new Date(t.sla.dueAt))}`;
}

/**
 * Who handles the ticket, as the inbox says who holds a conversation (U30, `holderOf`): its name, "Chưa giao" when nobody, and the
 * last 4 characters of the id when the API gives no name (K1c-1: `name` is null for a person without a name or no longer active).
 */
export function assigneeOf(t: Pick<Ticket, 'assignee'>): {
  readonly text: string;
  readonly title?: string;
  readonly none?: true;
} {
  if (!t.assignee) return { text: 'Chưa giao', none: true };
  const name = t.assignee.name?.trim();
  return name
    ? { text: name }
    : { text: `…${t.assignee.id.slice(-4)}`, title: 'Nhân viên chưa có tên' };
}

/** A time of the API in Viet Nam's time. */
export const timeText = (iso: string): string => TIME.format(new Date(iso));

/** When it last changed, in Viet Nam's time. */
export const changedAt = (t: Pick<Ticket, 'updatedAt'>): string => timeText(t.updatedAt);
