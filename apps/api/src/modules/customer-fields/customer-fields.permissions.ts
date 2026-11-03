import type { OrgRole } from '@gani/db';

// The custom fields of a company (J1, N191): every role reads them; only an Owner or an Admin defines, changes or ends one (CEO 02/11
// decision 4, the same as the tags).
const MANAGERS: readonly OrgRole[] = ['owner', 'admin'];

export const mayManageFields = (role: OrgRole): boolean => MANAGERS.includes(role);
