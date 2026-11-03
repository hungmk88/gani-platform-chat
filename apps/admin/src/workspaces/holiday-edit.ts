// #21 Workspace, tab "Ngày nghỉ", 2b-ii (CEO 03/11, brief 52–53): adding (`POST`), changing (`PATCH`, only what changed) a day off
// of the workspace (#570, #571). The checks are the API's (holidays.schemas.ts), so a day off it would refuse for its fields is
// never sent; whether it is over or meets another stays the API's to say (422, errors.ts): "today" is in the workspace's time.
import type { components } from '../api/schema';
import type { Holiday } from './holidays';

type HolidayCreate = components['schemas']['HolidayCreate'];
type HolidayChange = components['schemas']['HolidayChange'];

export const MAX_NAME = 100;

/** The form, as its inputs hold it. */
export interface HolidayDraft {
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

export const draftOf = (h: Holiday | null): HolidayDraft => ({
  name: h?.name ?? '',
  startsOn: h?.startsOn ?? '',
  endsOn: h?.endsOn ?? '',
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The day off as the API takes it (name trimmed 1–100, startsOn ≤ endsOn), or what to fix in words. */
export function holidayOf(d: HolidayDraft): HolidayCreate | string {
  const name = d.name.trim();
  if (!name) return 'Nhập tên ngày nghỉ.';
  if (name.length > MAX_NAME) return `Tên ngày nghỉ tối đa ${MAX_NAME} ký tự.`;
  if (!DATE.test(d.startsOn) || !DATE.test(d.endsOn)) return 'Chọn ngày bắt đầu và ngày kết thúc.';
  if (d.startsOn > d.endsOn) return 'Ngày kết thúc phải từ ngày bắt đầu trở đi.';
  return { name, startsOn: d.startsOn, endsOn: d.endsOn };
}

/** Only what changed (`HolidayChange`; `{}` when nothing did), or what to fix in words. */
export function holidayChangeOf(h: Holiday, d: HolidayDraft): HolidayChange | string {
  const whole = holidayOf(d);
  if (typeof whole === 'string') return whole;
  const change: { name?: string; startsOn?: string; endsOn?: string } = {};
  for (const k of ['name', 'startsOn', 'endsOn'] as const)
    if (whole[k] !== h[k]) change[k] = whole[k];
  return change;
}
