import type { OrgRole } from '@gani/db';

// Who sees which conversations (Phụ lục B rows 11–12). The table lives here, in one place, so a test can read it row by row:
// - owner, admin, manager: every conversation of their workspaces;
// - sales, support: their own and the unclaimed ones. Phụ lục B says "Team", but a conversation has no team until routing (S4), so
//   the narrow reading is enforced for now (N133);
// - marketing, viewer: none ("Owner bật được" for viewer has nowhere to be stored yet, N133).
// RLS has already limited every query to the organisation and the workspaces of the session; this narrows inside them.

export type ReadScope = 'workspace' | 'mine_or_unassigned' | 'none';

const READ_SCOPE: Readonly<Record<OrgRole, ReadScope>> = {
  owner: 'workspace',
  admin: 'workspace',
  manager: 'workspace',
  sales: 'mine_or_unassigned',
  support: 'mine_or_unassigned',
  marketing: 'none',
  viewer: 'none',
};

export const readScope = (role: OrgRole): ReadScope => READ_SCOPE[role];

/** May this person see this conversation, once RLS has let it through? Not seeing it is answered 404, never 403 (P9). */
export function canSee(
  role: OrgRole,
  userId: string,
  conversation: { readonly assignedUserId: string | null },
): boolean {
  const scope = readScope(role);
  if (scope === 'workspace') return true;
  if (scope === 'none') return false;
  return conversation.assignedUserId === null || conversation.assignedUserId === userId;
}

// Who may act on a conversation (Phụ lục B rows 13, 15–17; "Chờ khách" is the holder's, like closing). `any`: whoever holds it;
// `own`: only while the person holds it themselves; `none`: 403. Transfer for sales and support also needs a shared team (E2).
export type ConversationAction = 'claim' | 'wait_customer' | 'transfer' | 'assign' | 'close';
export type ActionScope = 'any' | 'own' | 'none';

const LEAD: Readonly<Record<ConversationAction, ActionScope>> = {
  claim: 'any',
  wait_customer: 'any',
  transfer: 'any',
  assign: 'any',
  close: 'any',
};
const AGENT: Readonly<Record<ConversationAction, ActionScope>> = {
  claim: 'any',
  wait_customer: 'own',
  transfer: 'own',
  assign: 'none',
  close: 'own',
};
const NOTHING: Readonly<Record<ConversationAction, ActionScope>> = {
  claim: 'none',
  wait_customer: 'none',
  transfer: 'none',
  assign: 'none',
  close: 'none',
};
const ACTIONS: Readonly<Record<OrgRole, Readonly<Record<ConversationAction, ActionScope>>>> = {
  owner: LEAD,
  admin: LEAD,
  manager: LEAD,
  sales: AGENT,
  support: AGENT,
  marketing: NOTHING,
  viewer: NOTHING,
};

export const actionScope = (role: OrgRole, action: ConversationAction): ActionScope =>
  ACTIONS[role][action];

/** May this person do `action` on this conversation as it is now? `own` is decided on who holds it, never on who asks. */
export function mayAct(
  role: OrgRole,
  userId: string,
  action: ConversationAction,
  conversation: { readonly assignedUserId: string | null },
): boolean {
  const scope = actionScope(role, action);
  return scope === 'any' || (scope === 'own' && conversation.assignedUserId === userId);
}
