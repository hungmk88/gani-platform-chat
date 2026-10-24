import { describe, expect, it } from 'vitest';

import { errorOf } from '../api/errors';
import type { Member } from '../members/list';
import { pickable, samePeople, workspaceMembersError } from './workspace-members';

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

describe('pickable', () => {
  it('offers the accounts of the company, active or suspended, never an invitation', () => {
    const all = [
      member({}),
      member({ id: 'm2', status: 'suspended' }),
      member({ id: 'm3', status: 'pending', userId: null }),
      member({ id: 'm4', status: 'expired', userId: null }),
    ];
    expect(pickable(all).map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('samePeople', () => {
  it('compares the picked ids with the list of the workspace, in any order', () => {
    const list = {
      data: [
        { memberId: 'm1', userId: 'u1', role: 'owner' as const },
        { memberId: 'm2', userId: 'u2', role: 'sales' as const },
      ],
    };
    expect(samePeople(new Set(['m2', 'm1']), list)).toBe(true);
    expect(samePeople(new Set(['m1']), list)).toBe(false);
    expect(samePeople(new Set(['m1', 'm3']), list)).toBe(false);
  });
});

describe('workspaceMembersError', () => {
  it('says one who is no longer a member, a refusal and a workspace gone in words of the screen', () => {
    expect(workspaceMembersError(errorOf(400, { code: 'validation_failed' }))).toMatch(/Tải lại/);
    expect(workspaceMembersError(errorOf(403, { code: 'forbidden' }))).toMatch(/Owner hoặc Admin/);
    expect(workspaceMembersError(errorOf(404, { code: 'not_found' }))).toMatch(/Không tìm thấy/);
    expect(workspaceMembersError(errorOf(503, {}))).toBe(errorOf(503, {}).message);
  });
});
