import { describe, expect, it } from 'vitest';

import type { Member } from '../members/list';
import type { Role } from '../nav';
import {
  assigneeLines,
  assigneesPath,
  canAssign,
  holderNameOf,
  mayAssign,
  namesHolder,
  type Assignee,
} from './assign';

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

describe('namesHolder, mayAssign and canAssign', () => {
  it('gives "Gán lại" to Owner, Admin and Manager, the holder by name to Owner and Admin only', () => {
    expect(['owner', 'admin', 'manager'].every((r) => mayAssign(r as Role))).toBe(true);
    for (const r of ['sales', 'support', 'marketing', 'viewer'] as const)
      expect(mayAssign(r)).toBe(false);
    expect(namesHolder('owner')).toBe(true);
    expect(namesHolder('admin')).toBe(true);
    expect(namesHolder('manager')).toBe(false);
    for (const state of ['HUMAN_ACTIVE', 'PENDING_CUSTOMER', 'HUMAN_WAITING_Q'] as const)
      expect(canAssign({ state })).toBe(true);
    for (const state of ['BOT_ACTIVE', 'CLOSED'] as const) expect(canAssign({ state })).toBe(false);
  });

  it('asks U31 for the purpose, the id escaped', () => {
    expect(assigneesPath('a/b', 'assign')).toBe('/v1/conversations/a%2Fb/assignees?purpose=assign');
  });
});

describe('assigneeLines', () => {
  const a = (over: Partial<Assignee>): Assignee => ({
    userId: '0190c000-0000-7000-8000-00000000aaaa',
    name: 'Trần Thu',
    role: 'support',
    teamId: 't1',
    teamName: 'CSKH',
    openCount: 2,
    maxConcurrent: 5,
    ...over,
  });

  it('says name, role, team and load, in the order U31 gives', () => {
    expect(
      assigneeLines([a({}), a({ userId: 'u2', name: null, teamName: null, role: 'manager' })]),
    ).toEqual([
      { userId: a({}).userId, label: 'Trần Thu · Support · CSKH · đang giữ 2/5', full: false },
      { userId: 'u2', label: 'Chưa có tên · Manager · đang giữ 2/5', full: false },
    ]);
  });

  it('keeps someone full in the list, saying so: the limit is not enforced before S4', () => {
    const [line] = assigneeLines([a({ openCount: 5, maxConcurrent: 5 })]);
    expect(line).toMatchObject({ full: true, label: 'Trần Thu · Support · CSKH · đã đầy 5/5' });
  });

  it('tells two lines that read the same apart by the end of their id', () => {
    const lines = assigneeLines([
      a({ userId: 'x-1111', name: null }),
      a({ userId: 'x-2222', name: null }),
      a({ userId: 'x-3333' }),
    ]);
    expect(lines.map((l) => l.label)).toEqual([
      'Chưa có tên · Support · CSKH · đang giữ 2/5 · …1111',
      'Chưa có tên · Support · CSKH · đang giữ 2/5 · …2222',
      'Trần Thu · Support · CSKH · đang giữ 2/5',
    ]);
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
