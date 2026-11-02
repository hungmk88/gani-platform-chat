// The working hours of a workspace (C10, Q7/U18, U44, N192): one day per ISO weekday (1 Monday … 7 Sunday), open from `opensAt` to
// `closesAt` with an optional break, or closed (null); and days off, whole local dates. All in the workspace's time zone. Pure: the
// store reads the rows, this decides. Times are "HH:MM" or "HH:MM:SS" (PostgreSQL `time`), dates "YYYY-MM-DD".

export interface OpenDay {
  readonly opensAt: string;
  readonly closesAt: string;
  readonly breakStartsAt?: string | null;
  readonly breakEndsAt?: string | null;
}

/** Index 0 is Monday, 6 Sunday; null is a closed day. */
export type WorkingWeek = readonly [
  OpenDay | null,
  OpenDay | null,
  OpenDay | null,
  OpenDay | null,
  OpenDay | null,
  OpenDay | null,
  OpenDay | null,
];

export interface DayOff {
  readonly startsOn: string;
  readonly endsOn: string;
}

/** A workspace with no hours set (CEO 02/11/2026, C10 answer): Monday to Friday 08:00–18:00, the weekend closed. No seed. */
export const DEFAULT_WORKING_WEEK: WorkingWeek = [
  { opensAt: '08:00', closesAt: '18:00' },
  { opensAt: '08:00', closesAt: '18:00' },
  { opensAt: '08:00', closesAt: '18:00' },
  { opensAt: '08:00', closesAt: '18:00' },
  { opensAt: '08:00', closesAt: '18:00' },
  null,
  null,
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Minutes since midnight of "HH:MM[:SS]". */
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** The local date ("YYYY-MM-DD"), ISO weekday (1–7) and minute of the day of `at` in `timeZone` (an IANA name). */
export function localTime(
  at: Date,
  timeZone: string,
): { date: string; weekday: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts['year']}-${parts['month']}-${parts['day']}`,
    weekday: WEEKDAYS.indexOf(parts['weekday'] ?? '') + 1,
    minute: Number(parts['hour']) * 60 + Number(parts['minute']),
  };
}

/** Whether the workspace is open at `at`: not a day off, an open day, inside its hours and outside its break. */
export function isOpen(
  q: { readonly week: WorkingWeek; readonly daysOff: readonly DayOff[]; readonly timeZone: string },
  at: Date,
): boolean {
  const now = localTime(at, q.timeZone);
  if (q.daysOff.some((d) => d.startsOn <= now.date && now.date <= d.endsOn)) return false;
  const day = q.week[now.weekday - 1];
  if (!day) return false;
  if (now.minute < minutes(day.opensAt) || now.minute >= minutes(day.closesAt)) return false;
  return !(
    day.breakStartsAt &&
    day.breakEndsAt &&
    now.minute >= minutes(day.breakStartsAt) &&
    now.minute < minutes(day.breakEndsAt)
  );
}
