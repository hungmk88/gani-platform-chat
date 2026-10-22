import type { OrgRole } from '@gani/db';
import { describe, expect, it } from 'vitest';

import { mayInvite } from './members.permissions.js';

describe('mayInvite (Phụ lục B)', () => {
  it('lets an Owner invite every role, an Admin every role but Owner, and nobody else', () => {
    const roles: OrgRole[] = [
      'owner',
      'admin',
      'manager',
      'sales',
      'support',
      'marketing',
      'viewer',
    ];
    const table = roles.map((actor) => roles.filter((role) => mayInvite(actor, role)).length);
    expect(table).toEqual([7, 6, 0, 0, 0, 0, 0]);
    expect([mayInvite('owner'), mayInvite('admin'), mayInvite('manager')]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
