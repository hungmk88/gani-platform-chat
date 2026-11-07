import { describe, expect, it } from 'vitest';

import { DEFAULT_WORKING_WEEK, isOpen, localTime, type WorkingWeek } from './business-hours.js';

const HCM = 'Asia/Ho_Chi_Minh';
/** 2026-11-02 is a Monday; Hồ Chí Minh City is UTC+7 all year. */
const at = (local: string) => new Date(`${local}+07:00`);
const open = (
  local: string,
  week: WorkingWeek = DEFAULT_WORKING_WEEK,
  daysOff = [] as { startsOn: string; endsOn: string }[],
) => isOpen({ week, daysOff, timeZone: HCM }, at(local));

describe('localTime', () => {
  it('reads the local date, ISO weekday and minute of an instant in a time zone', () => {
    expect(localTime(at('2026-11-02T00:00:00'), HCM)).toEqual({
      date: '2026-11-02',
      weekday: 1,
      minute: 0,
    });
    expect(localTime(at('2026-11-08T23:59:00'), HCM)).toEqual({
      date: '2026-11-08',
      weekday: 7,
      minute: 1439,
    });
    expect(localTime(new Date('2026-11-02T00:30:00Z'), 'Asia/Tokyo')).toMatchObject({
      minute: 570,
    });
  });
});

describe('isOpen', () => {
  it('is open Monday to Friday from 08:00 to 17:30 by default, closed 12:00–13:00 and at the weekend (Q7, N209)', () => {
    expect(open('2026-11-02T08:00:00')).toBe(true);
    expect(open('2026-11-02T07:59:00')).toBe(false);
    expect(open('2026-11-02T11:59:00')).toBe(true);
    expect(open('2026-11-02T12:00:00')).toBe(false);
    expect(open('2026-11-02T12:59:00')).toBe(false);
    expect(open('2026-11-02T13:00:00')).toBe(true);
    expect(open('2026-11-06T17:29:00')).toBe(true);
    expect(open('2026-11-06T17:30:00')).toBe(false);
    expect(open('2026-11-07T10:00:00')).toBe(false);
    expect(open('2026-11-08T10:00:00')).toBe(false);
  });

  it('is closed during a break and on a closed day of a set week', () => {
    const week: WorkingWeek = [
      {
        opensAt: '08:00:00',
        closesAt: '17:30:00',
        breakStartsAt: '12:00:00',
        breakEndsAt: '13:00:00',
      },
      null,
      null,
      null,
      null,
      { opensAt: '09:00', closesAt: '12:00', breakStartsAt: null, breakEndsAt: null },
      null,
    ];
    expect(open('2026-11-02T11:59:00', week)).toBe(true);
    expect(open('2026-11-02T12:30:00', week)).toBe(false);
    expect(open('2026-11-02T13:00:00', week)).toBe(true);
    expect(open('2026-11-03T10:00:00', week)).toBe(false);
    expect(open('2026-11-07T10:00:00', week)).toBe(true);
  });

  it('is closed on every local date of a day off, both ends included', () => {
    const daysOff = [{ startsOn: '2026-11-03', endsOn: '2026-11-04' }];
    expect(open('2026-11-02T10:00:00', DEFAULT_WORKING_WEEK, daysOff)).toBe(true);
    expect(open('2026-11-03T10:00:00', DEFAULT_WORKING_WEEK, daysOff)).toBe(false);
    expect(open('2026-11-04T10:00:00', DEFAULT_WORKING_WEEK, daysOff)).toBe(false);
    expect(open('2026-11-05T10:00:00', DEFAULT_WORKING_WEEK, daysOff)).toBe(true);
  });

  it('decides in the workspace time zone, not the server one', () => {
    const instant = new Date('2026-11-02T00:30:00Z');
    expect(isOpen({ week: DEFAULT_WORKING_WEEK, daysOff: [], timeZone: HCM }, instant)).toBe(false);
    expect(
      isOpen({ week: DEFAULT_WORKING_WEEK, daysOff: [], timeZone: 'Asia/Tokyo' }, instant),
    ).toBe(true);
  });
});
