// "Gán lại" on an open conversation (#6, `POST /v1/conversations/{id}/assign`, Phụ lục B row 16). The API takes a member of the
// conversation's workspace whose role may hold conversations, else 422 invalid_assignee. The list of valid recipients is U31 (open):
// until it comes, Owner and Admin pick from `GET /v1/members` (theirs only, N153); a Manager, who may assign too, waits for U31.
import type { Role } from '../nav';
import type { Member } from '../members/list';
import type { Conversation } from './list';

/** Who gets the button today: those who may assign and may read the members (Owner, Admin). */
export const assignsFromList = (role: Role): boolean => role === 'owner' || role === 'admin';

/** T16 (a person holds it) and T21 (still in the queue) of P14; not a closed conversation nor one the bot has. */
export const canAssign = (c: Pick<Conversation, 'state'>): boolean =>
  c.state === 'HUMAN_ACTIVE' || c.state === 'PENDING_CUSTOMER' || c.state === 'HUMAN_WAITING_Q';

const HOLDS: readonly Member['role'][] = ['owner', 'admin', 'manager', 'sales', 'support'];

/**
 * The members offered: active, of a role that may hold conversations, and not the one who holds it. Whether each is in the
 * conversation's workspace the members list does not say (N153): the API answers 422 for one who is not.
 */
export function assigneesOf(
  members: readonly Member[],
  holder: string | null,
): { readonly userId: string; readonly member: Member }[] {
  return members.flatMap((m) =>
    m.status === 'active' && m.userId && m.userId !== holder && HOLDS.includes(m.role)
      ? [{ userId: m.userId, member: m }]
      : [],
  );
}
