// #21 Workspace, tab "Giờ làm việc", 2a-ii (CEO 03/11, brief 53): changing the week of the workspace, a PUT of the whole week (#566;
// no version, the last writer wins). The checks are the API's (business-hours.schemas.ts), so a week it would refuse is never sent.
import { NO_HOURS, WEEKDAY, type BusinessDay, type BusinessHours } from './hours';

/** One row of the form, the hours as the inputs hold them ('' for none); a closed day keeps them, only the sent week drops them. */
export interface DayDraft {
  readonly weekday: number;
  readonly open: boolean;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly breakStartsAt: string;
  readonly breakEndsAt: string;
}

export const draftOf = (h: BusinessHours): DayDraft[] =>
  [...h.week]
    .sort((a, b) => a.weekday - b.weekday)
    .map((d) => ({
      weekday: d.weekday,
      open: d.open,
      opensAt: d.opensAt ?? '',
      closesAt: d.closesAt ?? '',
      breakStartsAt: d.breakStartsAt ?? '',
      breakEndsAt: d.breakEndsAt ?? '',
    }));

/** The week to send: a closed day has no hours, an empty break is none. */
export const weekOf = (draft: readonly DayDraft[]): BusinessDay[] =>
  draft.map(({ weekday, open, opensAt, closesAt, breakStartsAt, breakEndsAt }) =>
    open
      ? {
          weekday,
          open,
          opensAt,
          closesAt,
          breakStartsAt: breakStartsAt || null,
          breakEndsAt: breakEndsAt || null,
        }
      : { weekday, open, ...NO_HOURS },
  );

export const sameWeek = (a: readonly DayDraft[], b: readonly DayDraft[]) =>
  JSON.stringify(weekOf(a)) === JSON.stringify(weekOf(b));

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The first thing the API would refuse in the week, in words, or null when it may be sent. */
export function hoursProblem(draft: readonly DayDraft[]): string | null {
  for (const d of draft) {
    if (!d.open) continue;
    const day = WEEKDAY[d.weekday] ?? `Ngày ${d.weekday}`;
    if (!HHMM.test(d.opensAt) || !HHMM.test(d.closesAt))
      return `${day}: nhập giờ mở cửa và giờ đóng cửa.`;
    if (d.opensAt >= d.closesAt) return `${day}: giờ đóng cửa phải sau giờ mở cửa.`;
    const [from, to] = [d.breakStartsAt, d.breakEndsAt];
    if (!from && !to) continue;
    if (!HHMM.test(from) || !HHMM.test(to))
      return `${day}: nhập đủ hai giờ nghỉ giữa ca, hoặc để trống cả hai.`;
    if (!(d.opensAt < from && from < to && to < d.closesAt))
      return `${day}: giờ nghỉ giữa ca phải nằm trong giờ làm việc.`;
  }
  return null;
}
