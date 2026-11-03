// #21 Workspace, tab "Giờ làm việc" (CEO 03/11, brief 52–53): the working week of the workspace being worked in, on the real API
// `GET /v1/workspaces/{id}/business-hours` (#566, N192). 2a-i reads it; changing it (PUT of the whole week) is 2a-ii.
import type { components } from '../api/schema';

export type BusinessHours = components['schemas']['BusinessHours'];
export type BusinessDay = components['schemas']['BusinessDay'];

export const hoursPath = (workspaceId: string) =>
  `/v1/workspaces/${encodeURIComponent(workspaceId)}/business-hours`;

/** ISO weekdays, 1 Monday … 7 Sunday, in words. */
export const WEEKDAY: Readonly<Record<number, string>> = {
  1: 'Thứ 2',
  2: 'Thứ 3',
  3: 'Thứ 4',
  4: 'Thứ 5',
  5: 'Thứ 6',
  6: 'Thứ 7',
  7: 'Chủ nhật',
};

/** The hours of a closed day: none (the API refuses any). */
export const NO_HOURS = { opensAt: null, closesAt: null, breakStartsAt: null, breakEndsAt: null };

/** The columns after the day, each with its head; a cell is named after its day and head ("Thứ 2 mở cửa"). */
export const COLUMNS = [
  ['open', 'Làm việc'],
  ['opensAt', 'Mở cửa'],
  ['closesAt', 'Đóng cửa'],
  ['breakStartsAt', 'Nghỉ giữa ca từ'],
  ['breakEndsAt', 'Nghỉ giữa ca đến'],
] as const;
export type Column = (typeof COLUMNS)[number][0];

/** A cell of the week as read: "Có" or "Nghỉ", an hour, or "—" (a closed day, no break). */
export const cellText = (d: BusinessDay, column: Column): string =>
  column === 'open' ? (d.open ? 'Có' : 'Nghỉ') : (d[column] ?? '—');
