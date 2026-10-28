import { describe, expect, it } from 'vitest';

import type { Role } from '../nav';
import {
  assigneeLines,
  assigneesPath,
  canAssign,
  canTransfer,
  matching,
  mayAssign,
  type Assignee,
} from './assign';

describe('mayAssign and canAssign', () => {
  it('gives "Gán lại" to Owner, Admin and Manager', () => {
    expect(['owner', 'admin', 'manager'].every((r) => mayAssign(r as Role))).toBe(true);
    for (const r of ['sales', 'support', 'marketing', 'viewer'] as const)
      expect(mayAssign(r)).toBe(false);
    for (const state of ['HUMAN_ACTIVE', 'PENDING_CUSTOMER', 'HUMAN_WAITING_Q'] as const)
      expect(canAssign({ state })).toBe(true);
    for (const state of ['BOT_ACTIVE', 'CLOSED'] as const) expect(canAssign({ state })).toBe(false);
  });

  it('asks U31 for the purpose, the id escaped', () => {
    expect(assigneesPath('a/b', 'assign')).toBe('/v1/conversations/a%2Fb/assignees?purpose=assign');
  });
});

describe('canTransfer', () => {
  const c = (
    state: 'HUMAN_ACTIVE' | 'PENDING_CUSTOMER' | 'HUMAN_WAITING_Q' | 'BOT_ACTIVE' | 'CLOSED',
    holder: string | null,
  ) => ({
    state,
    assignedUserId: holder,
  });
  it('follows the API: leads any held conversation, Sales/Support their own, from HUMAN_ACTIVE or PENDING_CUSTOMER', () => {
    for (const r of ['owner', 'admin', 'manager'] as const)
      expect(canTransfer(c('HUMAN_ACTIVE', 'u2'), r, 'u1')).toBe(true);
    for (const r of ['sales', 'support'] as const) {
      expect(canTransfer(c('PENDING_CUSTOMER', 'u1'), r, 'u1')).toBe(true);
      expect(canTransfer(c('HUMAN_ACTIVE', 'u2'), r, 'u1')).toBe(false);
    }
    for (const r of ['marketing', 'viewer'] as const)
      expect(canTransfer(c('HUMAN_ACTIVE', 'u1'), r, 'u1')).toBe(false);
  });

  it('never for one in the queue, with the bot or closed: nobody holds it', () => {
    for (const state of ['HUMAN_WAITING_Q', 'BOT_ACTIVE', 'CLOSED'] as const)
      expect(canTransfer(c(state, 'u1'), 'owner', 'u1')).toBe(false);
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
    awaitingCustomerCount: 0,
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

describe('matching', () => {
  const lines = [
    { label: 'Trần Thu · Support · CSKH · đang giữ 2/5' },
    { label: 'Đỗ Minh · Manager · Sales B2B · đã đầy 5/5' },
    { label: 'Chưa có tên · Sales · đang giữ 0/5' },
  ];
  it('finds by any words of name, role or team, without accents or case', () => {
    expect(matching(lines, 'tran').map((l) => l.label)).toEqual([lines[0]!.label]);
    expect(matching(lines, 'do  MANAGER').map((l) => l.label)).toEqual([lines[1]!.label]);
    expect(matching(lines, 'sales').map((l) => l.label)).toEqual([
      lines[1]!.label,
      lines[2]!.label,
    ]);
    expect(matching(lines, '   ')).toHaveLength(3);
    expect(matching(lines, 'không ai')).toEqual([]);
  });
});
