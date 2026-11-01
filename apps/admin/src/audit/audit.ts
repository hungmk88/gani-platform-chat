// #28 Audit log of the company (CEO 31/10), read only: `GET /v1/audit-logs` of the real API (A9a #478, A9b #480; N174), Owner and
// Admin, newest first by cursor. The first screen of the admin on the real API, not a planned contract. The API gives ids only: a
// person is "Bạn", "Hệ thống" or the last 8 characters of the id (U72 asks for the name), an action is its code as given (U73 asks
// for the list of codes).
import type { components } from '../api/schema';

export type AuditLog = components['schemas']['AuditLog'];
export type AuditLogList = components['schemas']['AuditLogList'];

/** What the screen filters on: days are `YYYY-MM-DD` in Viet Nam's time, `to` included. */
export interface AuditFilter {
  readonly actorUserId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly from: string;
  readonly to: string;
}

// 50 = mặc định của hợp đồng (trần 100).
const LIMIT = '50';
/** As the API checks `action` and `targetType` (openapi: `pattern`, `maxLength`). */
const ACTION = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const MAX_ACTION = 64;
const TARGET_TYPE = /^[a-z][a-z0-9_]{0,63}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Viet Nam has no summer time: a day starts at 00:00 +07:00 all year. */
const VN = '+07:00';
const DAYS_SHOWN = 7;

const VN_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The day of `at` in Viet Nam, `YYYY-MM-DD`. */
export const vnDay = (at: Date): string => VN_DAY.format(at);

/** The day `n` days after `day` (`n` may be negative). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The window the screen opens on and "Bỏ lọc" goes back to (CEO 31/10): the last 7 days, today included. */
export function defaultWindow(now: Date): Pick<AuditFilter, 'from' | 'to'> {
  const today = vnDay(now);
  return { from: addDays(today, 1 - DAYS_SHOWN), to: today };
}

/** A real `YYYY-MM-DD` day (not 2026-02-30, which a Date reads as 2026-03-02). */
const isDay = (day: string): boolean =>
  DAY.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && addDays(day, 0) === day;
const isAction = (a: string): boolean => a.length <= MAX_ACTION && ACTION.test(a);

/** `dd/mm/yyyy` of a `YYYY-MM-DD` day, for the line above the table. */
export const dayText = (day: string): string => day.split('-').reverse().join('/');

/** What is wrong with the filter, as the API would refuse it (400), or null. */
export function filterProblem(f: AuditFilter): string | null {
  const action = f.action.trim();
  if (action && !isAction(action))
    return 'Hành động viết dạng <vật>.<động từ>, chữ thường không dấu, ví dụ member.role_changed.';
  const target = f.targetType.trim();
  if (target && !TARGET_TYPE.test(target))
    return 'Loại đối tượng viết chữ thường không dấu, ví dụ member.';
  if (!isDay(f.from) || !isDay(f.to)) return 'Chọn ngày bắt đầu và ngày kết thúc.';
  if (f.from > f.to) return 'Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.';
  return null;
}

/** The days are the 7 the screen opens on. */
export function isDefaultWindow(f: AuditFilter, now: Date): boolean {
  const w = defaultWindow(now);
  return f.from === w.from && f.to === w.to;
}

/** The filter of the page's URL: a part the API would refuse is dropped, never sent; no days or bad days are the 7 days. */
export function auditFilterOf(params: URLSearchParams, now: Date, meId: string): AuditFilter {
  const actor = params.get('actor') ?? '';
  const action = (params.get('action') ?? '').trim();
  const target = (params.get('target') ?? '').trim();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  return {
    actorUserId: actor && (actor === meId || UUID.test(actor)) ? actor : null,
    action: isAction(action) ? action : '',
    targetType: TARGET_TYPE.test(target) ? target : '',
    ...(isDay(from) && isDay(to) && from <= to ? { from, to } : defaultWindow(now)),
  };
}

/** The URL of a filter: the 7 days and no filter are an empty query. */
export function auditParamsOf(f: AuditFilter, now: Date): URLSearchParams {
  const p = new URLSearchParams();
  if (f.actorUserId) p.set('actor', f.actorUserId);
  if (f.action.trim()) p.set('action', f.action.trim());
  if (f.targetType.trim()) p.set('target', f.targetType.trim());
  if (!isDefaultWindow(f, now)) {
    p.set('from', f.from);
    p.set('to', f.to);
  }
  return p;
}

/** The request of one page: `to` is the day after the last day shown (the API leaves `to` out). */
export function logsPath(f: AuditFilter, cursor: string | null): string {
  const p = new URLSearchParams({ limit: LIMIT });
  if (f.actorUserId) p.set('actorUserId', f.actorUserId);
  if (f.action.trim()) p.set('action', f.action.trim());
  if (f.targetType.trim()) p.set('targetType', f.targetType.trim());
  p.set('from', new Date(`${f.from}T00:00:00${VN}`).toISOString());
  p.set('to', new Date(`${addDays(f.to, 1)}T00:00:00${VN}`).toISOString());
  if (cursor) p.set('cursor', cursor);
  return `/v1/audit-logs?${p.toString()}`;
}

/** Who acted, in words: the system, the person looking, or the last 8 characters of the id (random in a UUIDv7). */
export function actorOf(
  actorUserId: string | null,
  meId: string,
): { readonly text: string; readonly title?: string } {
  if (actorUserId === null) return { text: 'Hệ thống' };
  if (actorUserId === meId) return { text: 'Bạn', title: actorUserId };
  return { text: `Người dùng …${actorUserId.slice(-8)}`, title: actorUserId };
}

/** `<thing>.<verb>` cut in two, for the list of codes U73 asks for (not shown cut yet). */
export function splitAction(
  action: string,
): { readonly entity: string; readonly verb: string } | null {
  if (!ACTION.test(action)) return null;
  const dot = action.indexOf('.');
  return { entity: action.slice(0, dot), verb: action.slice(dot + 1) };
}

/** The detail as key–value lines of plain text: a value that is not a string, number or boolean is written as JSON. */
export function detailLines(
  detail: AuditLog['detail'],
): readonly { readonly key: string; readonly value: string; readonly code: boolean }[] {
  return Object.entries(detail).map(([key, v]) =>
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
      ? { key, value: String(v), code: false }
      : { key, value: JSON.stringify(v), code: true },
  );
}
