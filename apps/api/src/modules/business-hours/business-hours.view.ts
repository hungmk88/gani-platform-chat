import type { OpenDay, WorkingWeek } from '@gani/domain';

import type { BusinessDay } from './business-hours.schemas.js';

const hhmm = (time: string | null | undefined) => (time ? time.slice(0, 5) : null);

/** The week as the API gives it: seven days from Monday, hours as HH:MM. */
export function daysOf(week: WorkingWeek): BusinessDay[] {
  return week.map((day, i) => ({
    weekday: i + 1,
    open: day !== null,
    opensAt: hhmm(day?.opensAt),
    closesAt: hhmm(day?.closesAt),
    breakStartsAt: hhmm(day?.breakStartsAt),
    breakEndsAt: hhmm(day?.breakEndsAt),
  }));
}

/** The week as the store takes it, from seven days in any order. */
export function weekOf(days: readonly BusinessDay[]): WorkingWeek {
  return Array.from({ length: 7 }, (_, i): OpenDay | null => {
    const d = days.find((x) => x.weekday === i + 1);
    return d?.open && d.opensAt && d.closesAt
      ? {
          opensAt: d.opensAt,
          closesAt: d.closesAt,
          breakStartsAt: d.breakStartsAt,
          breakEndsAt: d.breakEndsAt,
        }
      : null;
  }) as unknown as WorkingWeek;
}

/** The weekdays whose hours differ between two weeks, as "1,3". */
export function changedWeekdays(before: WorkingWeek, after: WorkingWeek): string {
  const [a, b] = [daysOf(before), daysOf(after)];
  return a
    .filter((day, i) => JSON.stringify(day) !== JSON.stringify(b[i]))
    .map((day) => day.weekday)
    .join(',');
}
