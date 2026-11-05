import { describe, expect, it } from 'vitest';

import {
  canSeeLead,
  leadReadScope,
  mayCreateLead,
  mayWriteLead,
  type LeadOwnership,
} from './lead-access.js';
import type { OrgRole } from './schema/org-members.js';

// The table of who reads and changes leads (Phụ lục B "Lead", T-2, N188, N196), role by role.
const ME = 'me';
const theirs: LeadOwnership = { createdBy: 'other', ownerUserId: 'other' };
const made: LeadOwnership = { createdBy: ME, ownerUserId: 'other' };
const owned: LeadOwnership = { createdBy: 'other', ownerUserId: ME };
const roles: OrgRole[] = ['owner', 'admin', 'manager', 'sales', 'marketing', 'viewer', 'support'];
const row = (role: OrgRole) => {
  const viewer = { role, userId: ME };
  return {
    scope: leadReadScope(role),
    sees: [canSeeLead(viewer, made), canSeeLead(viewer, owned), canSeeLead(viewer, theirs)],
    creates: mayCreateLead(role),
    writes: [mayWriteLead(viewer, made), mayWriteLead(viewer, owned), mayWriteLead(viewer, theirs)],
  };
};

describe('lead access', () => {
  it('follows Phụ lục B role by role: [made, owned, someone else’s]', () => {
    const all = {
      scope: 'workspace',
      sees: [true, true, true],
      creates: true,
      writes: [true, true, true],
    };
    const readOnly = {
      scope: 'workspace',
      sees: [true, true, true],
      creates: false,
      writes: [false, false, false],
    };
    expect(Object.fromEntries(roles.map((role) => [role, row(role)]))).toEqual({
      owner: all,
      admin: all,
      manager: all,
      // A Sales sees and changes the leads they made or own, nobody else's (404, P9).
      sales: {
        scope: 'own',
        sees: [true, true, false],
        creates: true,
        writes: [true, true, false],
      },
      marketing: readOnly,
      viewer: readOnly,
      // Support: nothing, not even the pipeline (403 on all six paths, N196).
      support: {
        scope: 'none',
        sees: [false, false, false],
        creates: false,
        writes: [false, false, false],
      },
    });
  });

  it('counts a lead nobody follows as someone else’s for a Sales, unless they made it', () => {
    const sales = { role: 'sales' as const, userId: ME };
    expect(canSeeLead(sales, { createdBy: 'other', ownerUserId: null })).toBe(false);
    expect(canSeeLead(sales, { createdBy: ME, ownerUserId: null })).toBe(true);
  });
});
