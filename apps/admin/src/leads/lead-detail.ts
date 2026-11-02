// #13a Chi tiết lead, read only (CEO 02/11, brief 33, 36, 44–45): one lead from `GET /v1/leads/{id}` with what happened to it,
// oldest first, on the contract planned for S4 (docs/openapi/planned.json, #544, N188; questions 8–9 of
// docs/ui/lead-shape-from-be.md). No button changes the lead (12b, 12c). An event has no free text: the reason a lead was lost is
// the lead's own `lostReason`.
import type { components } from '../api/planned';
import { STATUS } from './leads';

export type LeadDetail = components['schemas']['LeadDetail'];
export type LeadEvent = components['schemas']['LeadEvent'];

export const leadPath = (id: string) => `/v1/leads/${encodeURIComponent(id)}`;

/** One line of the history in words; the API gives an id only, so people are "Bạn", "Người khác" or "Hệ thống" (as a ticket). */
export function eventText(e: LeadEvent, meId: string): string {
  const who = e.actorUserId === null ? 'Hệ thống' : e.actorUserId === meId ? 'Bạn' : 'Người khác';
  if (e.type === 'created')
    return e.toStage ? `${who} tạo lead ở ${e.toStage.name}` : `${who} tạo lead`;
  if (e.type === 'owner_changed') return `${who} đổi người phụ trách`;
  if (e.type === 'closed')
    return e.outcome ? `${who} đánh dấu ${STATUS[e.outcome][0]}` : `${who} đóng lead`;
  const to = e.toStage?.name ?? '?';
  return e.fromStage
    ? `${who} chuyển từ ${e.fromStage.name} sang ${to}`
    : `${who} chuyển sang ${to}`;
}
