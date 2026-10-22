import type { OrgRole } from '@gani/db';

/** Phụ lục B "Mời thành viên, đổi vai trò": an Owner invites any role, an Admin any but Owner, nobody else invites. */
export const mayInvite = (actor: OrgRole, role?: OrgRole): boolean =>
  actor === 'owner' || (actor === 'admin' && role !== 'owner');

/**
 * Why `actor` may not give `role` to the member `target` (N154), or null when it may. Nobody changes their own role; an Admin neither
 * makes an Owner nor touches one (Phụ lục B, prototype #19); the last active Owner stays one (`ownerIds`: the active Owners, locked).
 */
export function roleChangeRefusal(
  actor: { readonly userId: string; readonly role: OrgRole },
  target: { readonly id: string; readonly userId: string; readonly role: OrgRole },
  role: OrgRole,
  ownerIds: readonly string[],
): 'forbidden' | 'last_owner' | null {
  if (!mayInvite(actor.role) || target.userId === actor.userId) return 'forbidden';
  if (actor.role === 'admin' && (target.role === 'owner' || role === 'owner')) return 'forbidden';
  if (role !== 'owner' && ownerIds.length === 1 && ownerIds[0] === target.id) return 'last_owner';
  return null;
}
