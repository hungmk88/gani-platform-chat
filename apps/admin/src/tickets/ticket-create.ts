// #15(b) Tạo ticket (U27, N167, issue #357): `POST /v1/tickets` of the workspace being worked in, a contract planned for S4
// (docs/openapi/planned.json). The roles of the menu make tickets (Phụ lục B "Ticket: tạo"); the form checks what the API checks.
import type { components } from '../api/planned';
import { MAX_QUERY, nameOf, phoneText, type Customer } from '../customers/customers';
import type { Member } from '../members/list';
import type { Role } from '../nav';
import type { Ticket } from './tickets';

export type TicketCreate = components['schemas']['TicketCreate'];

export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 5000;

/**
 * Who sees the "Người nhận" field: a behaviour in TWO STAGES, not a bug (CEO 27/10, issue #357).
 * Stage 1 (now): Owner and Admin only, who read `GET /v1/members`; any other role never calls it (no 403 to be read).
 * Stage 2: every role that makes tickets, once the API has its list of assignees at workspace level
 * (proposed `GET /v1/workspaces/{id}/assignees?purpose=ticket`): the conversation's list of U31 does not fit a ticket without one.
 */
export const picksAssignee = (role: Role): boolean => role === 'owner' || role === 'admin';

// The roles a ticket may go to (U52, CEO 27/10): those who change tickets; Sales do not, so a ticket of theirs would be stuck.
// It must stay a subset of what the API accepts: if the API takes fewer, take them out here.
const HANDLES: readonly Member['role'][] = ['owner', 'admin', 'manager', 'support'];

/** The members offered: active, of a role that handles tickets, and of the workspace when its people are known (N159). */
export function ticketAssigneesOf(
  members: readonly Member[],
  inWorkspace: ReadonlySet<string> | null,
): { readonly userId: string; readonly name: string }[] {
  return members.flatMap((m) =>
    m.status === 'active' &&
    m.userId &&
    HANDLES.includes(m.role) &&
    (!inWorkspace || inWorkspace.has(m.id))
      ? [{ userId: m.userId, name: m.name ?? m.email }]
      : [],
  );
}

/** A ticket made from a conversation (#358): what the dialog fills in and sends besides the form. */
export interface TicketSource {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly customerId: string | null;
  readonly customerName: string;
  readonly title: string;
}

export interface TicketDraft {
  readonly title: string;
  readonly description: string;
  readonly priority: Ticket['priority'];
  readonly assigneeUserId: string;
  /** The customer picked in the dialog (#359), '' for none. */
  readonly customerId: string;
}

/** The body as the API takes it (trimmed, an empty description or assignee left out), or what is wrong with the form. */
export function ticketBodyOf(workspaceId: string, d: TicketDraft): TicketCreate | string {
  const title = d.title.trim();
  const description = d.description.trim();
  if (!title) return 'Nhập tiêu đề ticket.';
  if (title.length > MAX_TITLE) return `Tiêu đề tối đa ${MAX_TITLE} ký tự.`;
  if (description.length > MAX_DESCRIPTION) return `Mô tả tối đa ${MAX_DESCRIPTION} ký tự.`;
  return {
    workspaceId,
    title,
    priority: d.priority,
    ...(description ? { description } : {}),
    ...(d.assigneeUserId ? { assigneeUserId: d.assigneeUserId } : {}),
    ...(d.customerId ? { customerId: d.customerId } : {}),
  };
}

/** How many customers the search of the dialog shows (#359); with more, the person types more. */
export const CUSTOMER_PICKS = 10;

/** `GET /v1/customers` for the dialog: one short page of `q` (trimmed, ≤ 100; a name, the start of a phone, a whole email, U48). */
export function customerSearchPath(q: string): string {
  const params = new URLSearchParams({
    limit: String(CUSTOMER_PICKS),
    q: q.trim().slice(0, MAX_QUERY),
  });
  return `/v1/customers?${params.toString()}`;
}

/** A customer in one line: the name, then the phone as people write it, else the email, as the API gives them. */
export const customerLine = (c: Pick<Customer, 'displayName' | 'phone' | 'email'>): string =>
  [nameOf(c), c.phone ? phoneText(c.phone) : c.email].filter(Boolean).join(' · ');

/** Said when the customer picked is no longer visible (404 not_found): the pick is dropped, the rest of the form kept (CEO 28/10). */
export const CUSTOMER_GONE =
  'Khách này không còn thấy được. Đã bỏ chọn, chọn khách khác hoặc để trống.';
