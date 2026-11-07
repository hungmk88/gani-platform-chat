import { localTime, type DayOff, type OpenDay, type WorkingWeek } from './business-hours.js';

// Working time of a workspace (Q7 provisional values, CEO 07/11/2026; E2 of the SLA work): the SLA clock of a conversation runs only
// while the workspace works, in its time zone: never on a closed day or a day off, never before it opens, during its break, or after
// it closes. Pure: the store reads the hours and days off, this does the arithmetic. Instants are Dates (UTC); the schedule is local.

/** The default SLA of a conversation and its warning, in working time (Q7 provisional: 60 and 15 minutes; a constant in Đợt 1, N208). */
export const SLA_SECONDS = 60 * 60;
export const SLA_WARNING_SECONDS = 15 * 60;

export interface WorkSchedule {
  readonly week: WorkingWeek;
  readonly daysOff: readonly DayOff[];
  /** An IANA name, as `workspaces.timezone`. */
  readonly timeZone: string;
}

/** Days looked ahead before giving up: more than a year of days off and closed weeks means a schedule with no working time. */
const MAX_DAYS = 400;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** The working spans of a day, as [start, end) minutes of the local day: the hours, cut by the break. */
function spans(day: OpenDay | null): [number, number][] {
  if (!day) return [];
  const [open, close] = [minutes(day.opensAt), minutes(day.closesAt)];
  if (!day.breakStartsAt || !day.breakEndsAt) return [[open, close]];
  return [
    [open, minutes(day.breakStartsAt)],
    [minutes(day.breakEndsAt), close],
  ];
}

/** The offset of `timeZone` from UTC at `at`, in milliseconds (local wall time minus UTC). */
function offset(at: Date, timeZone: string): number {
  const l = localTime(at, timeZone);
  const [y, m, d] = l.date.split('-').map(Number) as [number, number, number];
  const wall =
    Date.UTC(y, m - 1, d, 0, l.minute) + at.getUTCSeconds() * 1000 + at.getUTCMilliseconds();
  return wall - at.getTime();
}

/** The instant of minute `minute` of the local date `date` in `timeZone`. */
function instant(date: string, minute: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 0, minute);
  // Twice: the offset at the guess may differ from the offset at the answer around a change of the clock.
  const guess = wall - offset(new Date(wall), timeZone);
  return wall - offset(new Date(guess), timeZone);
}

/** Each working span from the local day of `from` on, as instants [start, end), in order, at most MAX_DAYS days ahead. */
function* workingSpans(s: WorkSchedule, from: number): Generator<[number, number]> {
  let date = localTime(new Date(from), s.timeZone).date;
  for (let i = 0; i < MAX_DAYS; i++) {
    const off = s.daysOff.some((d) => d.startsOn <= date && date <= d.endsOn);
    const weekday = localTime(new Date(instant(date, 12 * 60, s.timeZone)), s.timeZone).weekday;
    if (!off)
      for (const [a, b] of spans(s.week[weekday - 1] ?? null))
        yield [instant(date, a, s.timeZone), instant(date, b, s.timeZone)];
    date = localTime(new Date(instant(date, 12 * 60, s.timeZone) + DAY), s.timeZone).date;
  }
}

/** The instant `seconds` of working time after `from`: the due time of an SLA started (or resumed) at `from`. */
export function addWorkingSeconds(s: WorkSchedule, from: Date, seconds: number): Date {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new RangeError('seconds must be a finite number ≥ 0');
  let left = seconds * 1000;
  if (left === 0) return new Date(from);
  for (const [a, b] of workingSpans(s, from.getTime())) {
    if (b <= from.getTime()) continue;
    const start = Math.max(a, from.getTime());
    if (left <= b - start) return new Date(start + left);
    left -= b - start;
  }
  throw new RangeError(`no working time in the ${MAX_DAYS} days after ${from.toISOString()}`);
}

/**
 * The working time from `from` to `to`, in seconds: what is left of an SLA paused at `from` and due at `to`. Negative when `to` is
 * before `from` (the SLA was overdue when it paused).
 */
export function workingSecondsBetween(s: WorkSchedule, from: Date, to: Date): number {
  if (to.getTime() < from.getTime()) return -workingSecondsBetween(s, to, from);
  let total = 0;
  for (const [a, b] of workingSpans(s, from.getTime())) {
    if (a >= to.getTime()) break;
    total += Math.max(0, Math.min(b, to.getTime()) - Math.max(a, from.getTime()));
  }
  return Math.floor(total / 1000);
}
