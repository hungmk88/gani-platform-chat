import { describe, expect, it } from 'vitest';

import type { WorkingWeek } from './business-hours.js';
import {
  addWorkingSeconds,
  SLA_SECONDS,
  SLA_WARNING_SECONDS,
  workingSecondsBetween,
  type WorkSchedule,
} from './working-time.js';

// The SLA clock in working time (E2; Q7 provisional values, CEO 07/11/2026): Monday to Friday 08:00–17:30, break 12:00–13:00, the
// weekend closed, Tết 2027 off, in Hồ Chí Minh City (UTC+7 all year). 2026-11-02 is a Monday, 2026-11-06 a Friday.
const DAY = { opensAt: '08:00', closesAt: '17:30', breakStartsAt: '12:00', breakEndsAt: '13:00' };
const WEEK: WorkingWeek = [DAY, DAY, DAY, DAY, DAY, null, null];
const TET = { startsOn: '2027-02-04', endsOn: '2027-02-10' };
const q7: WorkSchedule = { week: WEEK, daysOff: [TET], timeZone: 'Asia/Ho_Chi_Minh' };
const at = (local: string) => new Date(`${local}+07:00`);
const due = (local: string, s: WorkSchedule = q7) => addWorkingSeconds(s, at(local), SLA_SECONDS);

describe('the SLA of Q7', () => {
  it('is 60 minutes of working time, warned 15 minutes before', () => {
    expect([SLA_SECONDS, SLA_WARNING_SECONDS]).toEqual([3600, 900]);
  });
});

describe('addWorkingSeconds: the due time of a conversation that needs a person', () => {
  it('inside the hours: 60 minutes later', () => {
    expect(due('2026-11-03T09:00:00')).toEqual(at('2026-11-03T10:00:00'));
  });

  it('at 12:30, in the break: from 13:00, so 14:00', () => {
    expect(due('2026-11-03T12:30:00')).toEqual(at('2026-11-03T14:00:00'));
  });

  it('at 11:30: 30 minutes before the break and 30 after, so 13:30', () => {
    expect(due('2026-11-03T11:30:00')).toEqual(at('2026-11-03T13:30:00'));
  });

  it('at 16:00: 17:00 the same day', () => {
    expect(due('2026-11-03T16:00:00')).toEqual(at('2026-11-03T17:00:00'));
  });

  it('at 17:00 on a Friday: 30 minutes left that day, the other 30 from 08:00 on Monday, so 08:30 (CEO 07/11)', () => {
    // Brief 09 B6 wrote 09:00 Monday; in working time 17:00–17:30 already counts, as the CEO set on 07/11 (17:00 → 08:30 next day).
    expect(due('2026-11-06T17:00:00')).toEqual(at('2026-11-09T08:30:00'));
  });

  it('after the hours or on the weekend: from the next opening, so 09:00 on Monday', () => {
    expect(due('2026-11-06T19:00:00')).toEqual(at('2026-11-09T09:00:00'));
    expect(due('2026-11-07T10:00:00')).toEqual(at('2026-11-09T09:00:00'));
    expect(due('2026-11-09T06:00:00')).toEqual(at('2026-11-09T09:00:00'));
  });

  it('on a day off (Tết 2027): the next working day, Thursday 11/02 at 09:00', () => {
    expect(due('2027-02-05T10:00:00')).toEqual(at('2027-02-11T09:00:00'));
    expect(due('2027-02-03T17:00:00')).toEqual(at('2027-02-11T08:30:00'));
  });

  it('across the new year, with 01/01 off: Monday 04/01/2027 at 08:30', () => {
    const s = { ...q7, daysOff: [{ startsOn: '2027-01-01', endsOn: '2027-01-01' }] };
    expect(due('2026-12-31T17:00:00', s)).toEqual(at('2027-01-04T08:30:00'));
  });

  it('ends exactly at a boundary when the time fits: at the break or at closing', () => {
    expect(due('2026-11-03T11:00:00')).toEqual(at('2026-11-03T12:00:00'));
    expect(due('2026-11-03T16:30:00')).toEqual(at('2026-11-03T17:30:00'));
  });

  it('keeps seconds, gives back the start for 0, and refuses a negative or a schedule with no working time', () => {
    expect(addWorkingSeconds(q7, at('2026-11-03T09:00:30'), 90)).toEqual(at('2026-11-03T09:02:00'));
    expect(addWorkingSeconds(q7, at('2026-11-07T10:00:00'), 0)).toEqual(at('2026-11-07T10:00:00'));
    expect(() => addWorkingSeconds(q7, at('2026-11-03T09:00:00'), -1)).toThrow(RangeError);
    const closed: WorkSchedule = { ...q7, week: [null, null, null, null, null, null, null] };
    expect(() => addWorkingSeconds(closed, at('2026-11-03T09:00:00'), 60)).toThrow(RangeError);
  });

  it('reads the schedule in its own time zone', () => {
    const tokyo: WorkSchedule = { ...q7, timeZone: 'Asia/Tokyo' };
    // 08:00 in Hồ Chí Minh City is 10:00 in Tokyo: 60 minutes later is 11:00 Tokyo, 09:00 here.
    expect(addWorkingSeconds(tokyo, at('2026-11-03T08:00:00'), SLA_SECONDS)).toEqual(
      at('2026-11-03T09:00:00'),
    );
  });
});

describe('workingSecondsBetween: what is left of an SLA when it pauses', () => {
  it('counts only the working time: the break, the night and the weekend do not', () => {
    expect(workingSecondsBetween(q7, at('2026-11-03T11:45:00'), at('2026-11-03T13:15:00'))).toBe(
      30 * 60,
    );
    expect(workingSecondsBetween(q7, at('2026-11-06T17:15:00'), at('2026-11-09T08:30:00'))).toBe(
      45 * 60,
    );
    expect(workingSecondsBetween(q7, at('2026-11-07T10:00:00'), at('2026-11-08T10:00:00'))).toBe(0);
  });

  it('is negative when the SLA was already overdue (the caller keeps the old due time)', () => {
    expect(workingSecondsBetween(q7, at('2026-11-03T10:30:00'), at('2026-11-03T10:00:00'))).toBe(
      -30 * 60,
    );
  });

  it('paused at closing with 30 minutes left and resumed at the next opening: due 30 minutes later (CEO 07/11, Q-c)', () => {
    const dueAt = due('2026-11-03T17:00:00');
    expect(dueAt).toEqual(at('2026-11-04T08:30:00'));
    const left = workingSecondsBetween(q7, at('2026-11-03T17:30:00'), dueAt);
    expect(left).toBe(30 * 60);
    expect(addWorkingSeconds(q7, at('2026-11-04T08:00:00'), left)).toEqual(dueAt);
  });

  it('paused while waiting for the customer and resumed a day later: the rest runs from the resume', () => {
    const dueAt = due('2026-11-03T09:00:00');
    const left = workingSecondsBetween(q7, at('2026-11-03T09:40:00'), dueAt);
    expect(left).toBe(20 * 60);
    expect(addWorkingSeconds(q7, at('2026-11-04T15:00:00'), left)).toEqual(
      at('2026-11-04T15:20:00'),
    );
  });
});
