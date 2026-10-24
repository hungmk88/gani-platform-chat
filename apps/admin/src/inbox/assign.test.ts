import { describe, expect, it } from 'vitest';

import type { Member } from '../members/list';
import { assigneesOf, assignsFromList, canAssign, holderNameOf } from './assign';

const member = (over: Partial<Member>): Member => ({
  id: 'm1',
  userId: 'u1',
  name: 'Trần Thu',
  email: 'tranthu@example.test',
  role: 'sales',
  status: 'active',
  twoFactorEnabled: false,
  expiresAt: null,
  maxConcurrentConversations: null,
  ...over,
});

describe('assignsFromList and canAssign', () => {
  it('gives the button to Owner and Admin, on a conversation a person holds or that waits', () => {
    expect(assignsFromList('owner')).toBe(true);
    expect(assignsFromList('admin')).toBe(true);
    expect(assignsFromList('manager')).toBe(false);
    expect(assignsFromList('sales')).toBe(false);
    for (const state of ['HUMAN_ACTIVE', 'PENDING_CUSTOMER', 'HUMAN_WAITING_Q'] as const)
      expect(canAssign({ state })).toBe(true);
    for (const state of ['BOT_ACTIVE', 'CLOSED'] as const) expect(canAssign({ state })).toBe(false);
  });
});

describe('assigneesOf', () => {
  it('offers the active members who may hold it, never the holder, an invitation or a viewer', () => {
    const out = assigneesOf(
      [
        member({ userId: 'u1' }),
        member({ id: 'm2', userId: 'u2', role: 'admin' }),
        member({ id: 'm3', userId: 'u3', status: 'suspended' }),
        member({ id: 'm4', userId: null, status: 'pending' }),
        member({ id: 'm5', userId: 'u5', role: 'viewer' }),
        member({ id: 'm6', userId: 'u6', role: 'marketing' }),
      ],
      'u1',
    );
    expect(out.map((o) => o.userId)).toEqual(['u2']);
    expect(assigneesOf([member({})], null).map((o) => o.userId)).toEqual(['u1']);
  });
});

describe('holderNameOf', () => {
  it('names the holder from the members, and leaves me, nobody and a stranger to holderOf', () => {
    const members = [
      member({ userId: 'u2', name: 'Hà Linh' }),
      member({ userId: 'u3', name: null }),
    ];
    expect(holderNameOf(members, 'u2', 'u1')).toBe('Hà Linh');
    expect(holderNameOf(members, 'u3', 'u1')).toBe('tranthu@example.test');
    expect(holderNameOf(members, 'u1', 'u1')).toBeNull();
    expect(holderNameOf(members, null, 'u1')).toBeNull();
    expect(holderNameOf(members, 'u9', 'u1')).toBeNull();
  });
});
