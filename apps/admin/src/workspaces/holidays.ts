// #21 Workspace, tab "Ngày nghỉ" (CEO 03/11, brief 52–53: PR 2b): the days off of the workspace being worked in, on the real API
// `GET /v1/workspaces/{id}/holidays` (#570): the live days off that end today or later in the workspace's time, by start. 2b-i
// reads them; adding (`POST`), changing (`PATCH …/{hid}`) and removing (`DELETE …/{hid}`, #571) is 2b-ii.
import type { components } from '../api/schema';

export type Holiday = components['schemas']['Holiday'];
export type HolidayList = components['schemas']['HolidayList'];

export const holidaysPath = (workspaceId: string) =>
  `/v1/workspaces/${encodeURIComponent(workspaceId)}/holidays`;
export const holidayPath = (workspaceId: string, id: string) =>
  `${holidaysPath(workspaceId)}/${encodeURIComponent(id)}`;

/** A date of the API (YYYY-MM-DD) as the screen writes it: dd/mm/yyyy. */
export const dayText = (date: string) => date.split('-').reverse().join('/');

/** The dates of a day off: one day, or from … to …. */
export const spanText = (h: Pick<Holiday, 'startsOn' | 'endsOn'>) =>
  h.startsOn === h.endsOn ? dayText(h.startsOn) : `${dayText(h.startsOn)} – ${dayText(h.endsOn)}`;
