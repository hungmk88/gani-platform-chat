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
