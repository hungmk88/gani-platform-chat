import type { OrgRole } from '@gani/db';

// The tags of a company (J4, N190): every role reads them; only an Owner or an Admin makes, renames, hides or merges one (Brief
// Backend and the CEO over Phụ lục B's Manager, 02/11/2026).
const MANAGERS: readonly OrgRole[] = ['owner', 'admin'];

export const mayManageTags = (role: OrgRole): boolean => MANAGERS.includes(role);
