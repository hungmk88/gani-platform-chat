import { describe, expect, it } from 'vitest';

import { errorOf } from '../api/errors';
import type { Member } from '../members/list';
import { inWorkspace, teamMembersError, teamMembersPath, withCount } from './team-members';
import type { Team } from './teams';

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

const team = (over: Partial<Team>): Team => ({
  id: 't1',
  workspaceId: 'w1',
  name: 'CSKH',
  slug: 'cskh',
  description: null,
  isDefault: false,
  memberCount: 1,
  createdAt: '2026-10-24T00:00:00.000Z',
  ...over,
});

describe('teamMembersPath', () => {
  it('names the team', () => {
    expect(teamMembersPath('t/1')).toBe('/v1/teams/t%2F1/members');
  });
});

describe('inWorkspace', () => {
  it('offers the accounts that are people of the workspace, never an invitation', () => {
    const all = [
      member({}),
      member({ id: 'm2', status: 'suspended' }),
      member({ id: 'm3' }),
      member({ id: 'm4', status: 'pending', userId: null }),
    ];
    const people = {
      data: ['m1', 'm2', 'm4'].map((memberId) => ({
        memberId,
        userId: 'u',
        role: 'sales' as const,
      })),
    };
    expect(inWorkspace(all, people).map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('withCount and teamMembersError', () => {
  it('sets the number of people of one team only', () => {
    const list = { data: [team({}), team({ id: 't2', memberCount: 4 })] };
    expect(withCount(list, 't1', 3)?.data.map((t) => t.memberCount)).toEqual([3, 4]);
    expect(withCount(undefined, 't1', 3)).toBeUndefined();
  });

  it('says someone gone from the workspace, a refusal and a team gone in words of the screen', () => {
    expect(teamMembersError(errorOf(400, { code: 'validation_failed' }))).toMatch(/workspace/);
    expect(teamMembersError(errorOf(403, { code: 'forbidden' }))).toMatch(/Owner hoặc Admin/);
    expect(teamMembersError(errorOf(404, { code: 'not_found' }))).toMatch(/Không tìm thấy/);
    expect(teamMembersError(errorOf(503, {}))).toBe(errorOf(503, {}).message);
  });
});
