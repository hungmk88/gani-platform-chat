import type { OrgRole } from '@gani/db';

/** Phụ lục B "Mời thành viên, đổi vai trò": an Owner invites any role, an Admin any but Owner, nobody else invites. */
export const mayInvite = (actor: OrgRole, role?: OrgRole): boolean =>
  actor === 'owner' || (actor === 'admin' && role !== 'owner');
