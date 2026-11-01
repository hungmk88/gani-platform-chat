import { describe, expect, it } from 'vitest';

import {
  actorOf,
  addDays,
  auditFilterOf,
  auditParamsOf,
  dayText,
  defaultWindow,
  detailLines,
  filterProblem,
  logsPath,
  splitAction,
  vnDay,
  type AuditFilter,
} from './audit';

const ME = '0190f000-0000-7000-8000-000000000001';
const OTHER = '0190f000-0000-7000-8000-00009abcdef0';
const week: AuditFilter = {
  actorUserId: null,
  action: '',
  targetType: '',
  from: '2026-10-25',
  to: '2026-10-31',
};

describe('Audit log (#28)', () => {
  it('names who acted: the system, the person looking, or the last 8 characters of the id', () => {
    expect(actorOf(null, ME)).toEqual({ text: 'Hệ thống' });
    expect(actorOf(ME, ME)).toEqual({ text: 'Bạn', title: ME });
    // The first 8 characters of a UUIDv7 are its time: people made in the same minute would read the same.
    expect(actorOf(OTHER, ME)).toEqual({ text: 'Người dùng …9abcdef0', title: OTHER });
  });

  it('opens on the last 7 days of Viet Nam, today included', () => {
    // 31/10 01:30 in Viet Nam is still 30/10 in UTC.
    const now = new Date('2026-10-30T18:30:00Z');
    expect(vnDay(now)).toBe('2026-10-31');
    expect(defaultWindow(now)).toEqual({ from: '2026-10-25', to: '2026-10-31' });
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayText('2026-10-25')).toBe('25/10/2026');
  });

  it('asks from the first day at 00:00 to the day after the last (the API leaves `to` out), in Viet Nam time', () => {
    const p = new URL(logsPath(week, null), 'http://x').searchParams;
    expect(p.get('from')).toBe('2026-10-24T17:00:00.000Z');
    expect(p.get('to')).toBe('2026-10-31T17:00:00.000Z');
    expect(p.get('limit')).toBe('50');
    expect([...p.keys()].sort()).toEqual(['from', 'limit', 'to']);
    const all = new URL(
      logsPath(
        { ...week, actorUserId: OTHER, action: ' member.role_changed ', targetType: 'member' },
        'c 2',
      ),
      'http://x',
    ).searchParams;
    expect(all.get('actorUserId')).toBe(OTHER);
    expect(all.get('action')).toBe('member.role_changed');
    expect(all.get('targetType')).toBe('member');
    expect(all.get('cursor')).toBe('c 2');
  });

  it('refuses before sending what the API would refuse (400)', () => {
    expect(filterProblem(week)).toBeNull();
    expect(filterProblem({ ...week, action: 'member.role_changed' })).toBeNull();
    for (const action of [
      'member',
      'Member.role_changed',
      'member.role-changed',
      `a.${'b'.repeat(63)}`,
    ])
      expect(filterProblem({ ...week, action })).toMatch(/^Hành động viết dạng/);
    expect(filterProblem({ ...week, targetType: 'Member' })).toMatch(/^Loại đối tượng/);
    expect(filterProblem({ ...week, from: '' })).toBe('Chọn ngày bắt đầu và ngày kết thúc.');
    expect(filterProblem({ ...week, from: '2026-11-01' })).toBe(
      'Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.',
    );
    expect(filterProblem({ ...week, from: '2026-10-31' })).toBeNull();
    expect(filterProblem({ ...week, from: '2026-02-30' })).toBe(
      'Chọn ngày bắt đầu và ngày kết thúc.',
    );
  });

  it('keeps the filter in the URL, dropping what the API would refuse; the 7 days and no filter are no query', () => {
    const now = new Date('2026-10-31T05:00:00Z');
    const of = (q: string) => auditFilterOf(new URLSearchParams(q), now, ME);
    expect(of('')).toEqual(week);
    expect(auditParamsOf(week, now).toString()).toBe('');
    const all = {
      actorUserId: OTHER,
      action: 'team.created',
      targetType: 'team',
      from: '2026-10-01',
      to: '2026-10-02',
    };
    expect(of(auditParamsOf(all, now).toString())).toEqual(all);
    // The stub's ids are not UUIDs: the person signed in is always taken.
    expect(
      auditFilterOf(new URLSearchParams('actor=user-owner'), now, 'user-owner').actorUserId,
    ).toBe('user-owner');
    expect(of('actor=nobody&action=Team&target=Team&from=2026-10-05&to=2026-10-01')).toEqual(week);
    expect(of('from=2026-02-30&to=2026-10-31')).toEqual(week);
    expect(of('from=2026-10-30&to=2026-10-31').from).toBe('2026-10-30');
  });

  it('cuts an action in two for the list of codes (U73)', () => {
    expect(splitAction('member.two_factor_reset')).toEqual({
      entity: 'member',
      verb: 'two_factor_reset',
    });
    expect(splitAction('member')).toBeNull();
  });

  it('writes the detail as plain key–value lines, nested values as JSON', () => {
    expect(
      detailLines({ reason: '<b>Mất máy</b>', count: 2, ok: true, ids: ['a'], role: null }),
    ).toEqual([
      { key: 'reason', value: '<b>Mất máy</b>', code: false },
      { key: 'count', value: '2', code: false },
      { key: 'ok', value: 'true', code: false },
      { key: 'ids', value: '["a"]', code: true },
      { key: 'role', value: 'null', code: true },
    ]);
    expect(detailLines({})).toEqual([]);
  });
});
