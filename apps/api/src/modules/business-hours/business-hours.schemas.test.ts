import { DEFAULT_WORKING_WEEK } from '@gani/domain';
import { describe, expect, it } from 'vitest';

import { BusinessDaySchema, BusinessHoursChangeSchema } from './business-hours.schemas.js';
import { changedWeekdays, daysOf, weekOf } from './business-hours.view.js';

const closed = {
  open: false,
  opensAt: null,
  closesAt: null,
  breakStartsAt: null,
  breakEndsAt: null,
};
const open = {
  open: true,
  opensAt: '08:00',
  closesAt: '17:00',
  breakStartsAt: null,
  breakEndsAt: null,
};
const ok = (day: object) => BusinessDaySchema.safeParse({ weekday: 1, ...day }).success;

describe('BusinessDaySchema', () => {
  it('takes an open day with or without a break inside it, or a closed day without hours', () => {
    expect([
      ok(open),
      ok({ ...open, breakStartsAt: '12:00', breakEndsAt: '13:00' }),
      ok(closed),
    ]).toEqual([true, true, true]);
    for (const bad of [
      { ...closed, opensAt: '08:00' },
      { ...open, opensAt: null },
      { ...open, opensAt: '17:00', closesAt: '08:00' },
      { ...open, breakStartsAt: '12:00' },
      { ...open, breakStartsAt: '07:00', breakEndsAt: '09:00' },
      { ...open, breakStartsAt: '13:00', breakEndsAt: '12:00' },
      { ...open, opensAt: '8:00' },
      { ...open, closesAt: '24:00' },
    ])
      expect(ok(bad), JSON.stringify(bad)).toBe(false);
  });

  it('wants the seven weekdays once each', () => {
    const week = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, ...closed }));
    expect(BusinessHoursChangeSchema.safeParse({ week }).success).toBe(true);
    expect(BusinessHoursChangeSchema.safeParse({ week: week.slice(1) }).success).toBe(false);
    expect(BusinessHoursChangeSchema.safeParse({ week: [...week.slice(1), week[1]] }).success).toBe(
      false,
    );
  });
});

describe('the week of the API and of the store', () => {
  it('turns one into the other, and names the weekdays that changed', () => {
    const days = daysOf(DEFAULT_WORKING_WEEK);
    expect(days[0]).toEqual({ weekday: 1, ...open, closesAt: '18:00' });
    expect(days[6]).toEqual({ weekday: 7, ...closed });
    expect(daysOf(weekOf([...days].reverse()))).toEqual(days);
    const changed = weekOf(days.map((d) => (d.weekday === 3 ? { ...d, ...closed } : d)));
    expect(changedWeekdays(DEFAULT_WORKING_WEEK, changed)).toBe('3');
    expect(changedWeekdays(DEFAULT_WORKING_WEEK, DEFAULT_WORKING_WEEK)).toBe('');
  });
});
