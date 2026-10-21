// The actions on an open conversation (#6, I1c) a person is offered: the same rule as the API (Phụ lục B rows 13, 15–17,
// apps/api permissions.ts and the FSM of P14), so a button is never shown only to be refused. The API still decides.
import type { Role } from '../nav';
import type { Conversation } from './list';

export type Action = 'claim' | 'wait_customer' | 'close';

/** The roles that read conversations (Phụ lục B rows 11–12): the Inbox and its realtime connection are theirs only. */
export const readsConversations = (role: Role) =>
  ['owner', 'admin', 'manager', 'sales', 'support'].includes(role);

const LEADS: readonly Role[] = ['owner', 'admin', 'manager'];
const AGENTS: readonly Role[] = ['sales', 'support'];
const HUMAN = new Set(['HUMAN_ACTIVE', 'PENDING_CUSTOMER']);

/** T05/T06 claim from the queue or the out-of-hours hold; T09 wait for the customer; T13 close. Sales/support: their own only. */
export function actionsFor(
  c: Pick<Conversation, 'state' | 'afterHoursHold'> & { readonly assignedUserId: string | null },
  role: Role,
  meId: string,
): Action[] {
  if (!LEADS.includes(role) && !AGENTS.includes(role)) return [];
  const mine = LEADS.includes(role) || c.assignedUserId === meId;
  const out: Action[] = [];
  if (c.state === 'HUMAN_WAITING_Q' || (c.state === 'BOT_ACTIVE' && c.afterHoursHold))
    out.push('claim');
  if (c.state === 'HUMAN_ACTIVE' && mine) out.push('wait_customer');
  if (HUMAN.has(c.state) && mine) out.push('close');
  return out;
}

export const ACTION_LABEL: Readonly<Record<Action, string>> = {
  claim: 'Nhận',
  wait_customer: 'Chờ khách',
  close: 'Đóng',
};
export const ACTION_PATH: Readonly<Record<Action, string>> = {
  claim: 'claim',
  wait_customer: 'wait-customer',
  close: 'close',
};

/** The outcomes of closing (Brief v1.0, N130), each one click of the dialog (CEO). */
export const OUTCOMES = [
  ['resolved', 'Đã xong'],
  ['no_response', 'Khách không phản hồi'],
  ['spam', 'Spam'],
] as const;
export type Outcome = (typeof OUTCOMES)[number][0];

/** The body of each action: claim sends none, the others send the version last read (FSM spec §6). */
export function bodyOf(action: Action, version: number, outcome?: Outcome): object | undefined {
  if (action === 'claim') return undefined;
  return action === 'close' ? { version, outcome } : { version };
}
