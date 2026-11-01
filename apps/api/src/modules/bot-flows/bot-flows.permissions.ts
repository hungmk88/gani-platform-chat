import type { OrgRole } from '@gani/db';

// Phụ lục B dòng 35: building and publishing the scripted bot is Owner, Admin, Manager; they alone read the flows too (A, 01/11/2026).
const BUILDERS: readonly OrgRole[] = ['owner', 'admin', 'manager'];

export const mayBuildBotFlows = (role: OrgRole): boolean => BUILDERS.includes(role);
