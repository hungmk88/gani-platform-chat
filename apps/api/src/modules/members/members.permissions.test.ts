import type { OrgRole } from '@gani/db';
import { describe, expect, it } from 'vitest';

import { mayInvite, mayResetTwoFactor, roleChangeRefusal } from './members.permissions.js';

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

describe('roleChangeRefusal (N154)', () => {
  const owner = { userId: 'u-owner', role: 'owner' as const };
  const admin = { userId: 'u-admin', role: 'admin' as const };
  const member = (role: OrgRole, id = 'm-target') => ({ id, userId: `u-${id}`, role });

  it('lets an Owner give any role to anyone else, and keeps the last active Owner one', () => {
    expect(roleChangeRefusal(owner, member('sales'), 'owner', ['m-owner'])).toBeNull();
    expect(roleChangeRefusal(owner, member('owner'), 'admin', ['m-owner', 'm-target'])).toBeNull();
    expect(roleChangeRefusal(owner, member('owner'), 'admin', ['m-target'])).toBe('last_owner');
    expect(roleChangeRefusal(owner, member('owner'), 'owner', ['m-target'])).toBeNull();
  });

  it("refuses one's own role, an Admin with an Owner either way, and every other role", () => {
    expect(
      roleChangeRefusal(owner, { id: 'm-owner', userId: 'u-owner', role: 'owner' }, 'sales', [
        'm-owner',
        'x',
      ]),
    ).toBe('forbidden');
    expect(roleChangeRefusal(admin, member('owner'), 'sales', ['m-target', 'x'])).toBe('forbidden');
    expect(roleChangeRefusal(admin, member('sales'), 'owner', ['x'])).toBe('forbidden');
    expect(roleChangeRefusal(admin, member('sales'), 'admin', ['x'])).toBeNull();
    expect(
      roleChangeRefusal({ userId: 'u-m', role: 'manager' }, member('sales'), 'viewer', ['x']),
    ).toBe('forbidden');
  });
});

describe('mayResetTwoFactor (N155)', () => {
  const target = (role: OrgRole) => ({ userId: 'u-target', role });

  it("lets an Owner reset anyone else's, an Admin anyone's but an Owner's, and nobody their own or below Admin", () => {
    expect(mayResetTwoFactor({ userId: 'u-o', role: 'owner' }, target('owner'))).toBe(true);
    expect(mayResetTwoFactor({ userId: 'u-a', role: 'admin' }, target('admin'))).toBe(true);
    expect(mayResetTwoFactor({ userId: 'u-a', role: 'admin' }, target('owner'))).toBe(false);
    expect(mayResetTwoFactor({ userId: 'u-target', role: 'owner' }, target('owner'))).toBe(false);
    expect(mayResetTwoFactor({ userId: 'u-m', role: 'manager' }, target('sales'))).toBe(false);
  });
});
