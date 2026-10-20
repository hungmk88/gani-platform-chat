import type { OrgRole } from '@gani/db';
import { describe, expect, it } from 'vitest';

import { canSee, readScope } from './permissions.js';

const ME = '0190a000-0000-7000-8000-000000000001';
const OTHER = '0190a000-0000-7000-8000-000000000002';

describe('who sees which conversations (Phụ lục B rows 11–12, N133)', () => {
  it('gives each of the seven roles its scope', () => {
    const roles: OrgRole[] = [
      'owner',
      'admin',
      'manager',
      'sales',
      'support',
      'marketing',
      'viewer',
    ];
    expect(Object.fromEntries(roles.map((r) => [r, readScope(r)]))).toEqual({
      owner: 'workspace',
      admin: 'workspace',
      manager: 'workspace',
      sales: 'mine_or_unassigned',
      support: 'mine_or_unassigned',
      marketing: 'none',
      viewer: 'none',
    });
  });

  it('lets sales and support see their own and the unclaimed, a manager everything, marketing nothing', () => {
    const [mine, theirs, free] = [
      { assignedUserId: ME },
      { assignedUserId: OTHER },
      { assignedUserId: null },
    ];
    expect([mine, theirs, free].map((c) => canSee('sales', ME, c))).toEqual([true, false, true]);
    expect([mine, theirs, free].map((c) => canSee('support', ME, c))).toEqual([true, false, true]);
    expect([mine, theirs, free].map((c) => canSee('manager', ME, c))).toEqual([true, true, true]);
    expect([mine, theirs, free].map((c) => canSee('marketing', ME, c))).toEqual([
      false,
      false,
      false,
    ]);
  });
});
