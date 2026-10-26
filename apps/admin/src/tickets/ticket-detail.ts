// #15 Chi tiết ticket (U27, N167): one ticket from `GET /v1/tickets/{id}` with what happened to it, and its status changed by
// `PATCH {status, version}`, a contract planned for S4 (docs/openapi/planned.json). The moves are the API's (Backend's letter of
// 26/10, docs/ui/openapi-planned-30-10.md), so a button is never shown only to be refused. The API still decides.
import type { components } from '../api/planned';
import type { Role } from '../nav';
import { STATUS, type TicketStatus } from './tickets';

export type TicketDetail = components['schemas']['TicketDetail'];
export type TicketEvent = components['schemas']['TicketEvent'];

export const ticketPath = (id: string) => `/v1/tickets/${encodeURIComponent(id)}`;

/** Where each status may go: new → in_progress → waiting_customer ⇄ in_progress → done (reopened to in_progress); cancelled is final. */
export const NEXT: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  new: ['in_progress', 'cancelled'],
  in_progress: ['waiting_customer', 'done', 'cancelled'],
  waiting_customer: ['in_progress', 'done', 'cancelled'],
  done: ['in_progress'],
  cancelled: [],
};

const LEADS: readonly Role[] = ['owner', 'admin', 'manager'];

/** Change a ticket (Phụ lục B): Owner, Admin, Manager and Support; Sales make tickets and read theirs only. */
export const mayChangeTickets = (role: Role | null): boolean =>
  role !== null && (LEADS.includes(role) || role === 'support');

/** The statuses this person may move the ticket to; cancelling is Owner/Admin/Manager only. */
export function movesFor(status: TicketStatus, role: Role | null): TicketStatus[] {
  if (!mayChangeTickets(role)) return [];
  return NEXT[status].filter((to) => to !== 'cancelled' || LEADS.includes(role as Role));
}

/** The words of a move's button, which depend on where it comes from. */
export function moveLabel(from: TicketStatus, to: TicketStatus): string {
  if (to === 'in_progress')
    return from === 'new' ? 'Bắt đầu xử lý' : from === 'done' ? 'Mở lại' : 'Tiếp tục xử lý';
  if (to === 'waiting_customer') return 'Chờ khách';
  if (to === 'done') return 'Đã xong';
  return 'Hủy ticket';
}

/** One line of the history in words; the API gives an id only, so people are "Bạn", "Người khác" or "Hệ thống". */
export function eventText(e: TicketEvent, meId: string): string {
  const who = e.actorUserId === null ? 'Hệ thống' : e.actorUserId === meId ? 'Bạn' : 'Người khác';
  if (e.type === 'created') return `${who} tạo ticket`;
  if (e.type === 'assigned') return `${who} đổi người phụ trách`;
  if (e.type === 'edited') return `${who} sửa ticket`;
  const to = e.toStatus ? STATUS[e.toStatus][0] : '?';
  return e.fromStatus
    ? `${who} chuyển từ ${STATUS[e.fromStatus][0]} sang ${to}`
    : `${who} chuyển sang ${to}`;
}
