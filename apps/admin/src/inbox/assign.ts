// "Gán lại" on an open conversation (#6, `POST /v1/conversations/{id}/assign`, Phụ lục B row 16, issue #366). Who it may go to is
// U31 (`GET /v1/conversations/{id}/assignees?purpose=assign`, N168): the people the action accepts, so a pick is never refused
// with 422 invalid_assignee for being outside the rule. Owner, Admin and Manager assign; only Owner and Admin read the members.
import type { components } from '../api/schema';
import { ROLE_NAME, type Role } from '../nav';
import type { Member } from '../members/list';
import type { Conversation } from './list';

export type Assignee = components['schemas']['Assignee'];

/** Who reads `GET /v1/members` (N153), so sees the holder by name: Owner and Admin. */
export const namesHolder = (role: Role): boolean => role === 'owner' || role === 'admin';

/** Who gets "Gán lại" (Phụ lục B row 16, as the API): Owner, Admin, Manager. */
export const mayAssign = (role: Role): boolean =>
  role === 'owner' || role === 'admin' || role === 'manager';

/** T16 (a person holds it) and T21 (still in the queue) of P14; not a closed conversation nor one the bot has. */
export const canAssign = (c: Pick<Conversation, 'state'>): boolean =>
  c.state === 'HUMAN_ACTIVE' || c.state === 'PENDING_CUSTOMER' || c.state === 'HUMAN_WAITING_Q';

export const assigneesPath = (id: string, purpose: 'assign' | 'transfer') =>
  `/v1/conversations/${encodeURIComponent(id)}/assignees?purpose=${purpose}`;

/**
 * One line per person U31 lists, in its order (by name, no name last). U31 has no paging and leaves nobody out for being full:
 * someone at or over their limit (`openCount >= maxConcurrent`) is still listed and still accepted (the limit is not enforced
 * before S4), so the line says "đã đầy" and a lead may still pick them. Two lines that would read the same (no name, same role
 * and team, same count) get the last 4 characters of the id, so they can be told apart.
 */
export function assigneeLines(
  list: readonly Assignee[],
): { readonly userId: string; readonly label: string; readonly full: boolean }[] {
  const lines = list.map((a) => {
    const full = a.openCount >= a.maxConcurrent;
    const team = a.teamName ? ` · ${a.teamName}` : '';
    const load = `${full ? 'đã đầy' : 'đang giữ'} ${a.openCount}/${a.maxConcurrent}`;
    return {
      userId: a.userId,
      label: `${a.name ?? 'Chưa có tên'} · ${ROLE_NAME[a.role]}${team} · ${load}`,
      full,
    };
  });
  const seen = new Map<string, number>();
  for (const l of lines) seen.set(l.label, (seen.get(l.label) ?? 0) + 1);
  return lines.map((l) =>
    (seen.get(l.label) ?? 0) > 1 ? { ...l, label: `${l.label} · …${l.userId.slice(-4)}` } : l,
  );
}

/** Who holds it, by name, for those who read the members (Owner, Admin): "Tôi", the name, or the words of `holderOf` otherwise. */
export function holderNameOf(
  members: readonly Member[],
  holder: string | null,
  meId: string,
): string | null {
  if (holder === null || holder === meId) return null;
  const m = members.find((x) => x.userId === holder);
  return m ? (m.name ?? m.email) : null;
}
