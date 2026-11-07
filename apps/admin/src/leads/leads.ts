// #12 Pipeline lead (CEO 02/11, brief 28–30): read only, on the contract of #544 (N188), served since L4 (docs/openapi/openapi.json,
// generated in src/api/schema.d.ts).
// - `GET /v1/leads`: the leads of a workspace by cursor (`limit` at most 100); other filters of the contract are not used here.
// - `GET /v1/workspaces/{id}/pipeline`: the steps in the order of the pipeline; `position` and `lostReasons` are not used here.
// The names of the steps and the reasons a lead is lost come from the API only: Q9 has not settled them, none is written here.
import type { components } from '../api/schema';

type Schemas = components['schemas'];

/** T-2 (N188, CEO 03/11): Support may not read leads; the API answers 403, the screens say so before asking. */
export const deniedLeads = (role: string) => role === 'support';
/** A step of the workspace's pipeline, as the API names it; the steps come in the order of the pipeline. */
export type PipelineStage = Schemas['PipelineStage'];
export type Pipeline = Schemas['Pipeline'];
/** Open, or closed as won or lost (U6: Thắng/Thua are not steps; `POST /v1/leads/{id}/close`, P9). */
export type LeadStatus = Schemas['Lead']['status'];
/** `stage` is the step the lead is at, or was at when it was closed. */
export type Lead = Schemas['Lead'];
export type LeadPage = Schemas['LeadPage'];

/** `GET /v1/leads` of the workspace, by cursor (P9). */
export function leadsPath(workspaceId: string, cursor: string | null): string {
  const p = new URLSearchParams({ workspaceId, limit: '100' });
  if (cursor) p.set('cursor', cursor);
  return `/v1/leads?${p.toString()}`;
}
/** `GET /v1/leads` of one customer, every workspace of the session, by cursor (#8, CEO brief 169 P3). */
export function customerLeadsPath(customerId: string, cursor: string | null): string {
  const p = new URLSearchParams({ customerId, limit: '50' });
  if (cursor) p.set('cursor', cursor);
  return `/v1/leads?${p.toString()}`;
}
export const pipelinePath = (workspaceId: string) =>
  `/v1/workspaces/${encodeURIComponent(workspaceId)}/pipeline`;

export const STATUS: Readonly<Record<LeadStatus, readonly [string, 'ok' | 'error' | null]>> = {
  open: ['Đang chạy', null],
  won: ['Thắng', 'ok'],
  lost: ['Thua', 'error'],
};

export interface Column {
  readonly key: string;
  readonly title: string;
  readonly leads: readonly Lead[];
}

/**
 * The columns of the board (brief 29 (2)): the steps in the pipeline's order with their open leads, then Thắng and Thua, extra
 * columns and not a filter. An open lead at a step the pipeline no longer lists is kept, in a column of its own after the steps.
 */
export function columnsOf(stages: readonly PipelineStage[], leads: readonly Lead[]): Column[] {
  const known = new Set(stages.map((s) => s.id));
  const open = leads.filter((l) => l.status === 'open');
  const orphans = open.filter((l) => !known.has(l.stage.id));
  return [
    ...stages.map((s) => ({
      key: s.id,
      title: s.name,
      leads: open.filter((l) => l.stage.id === s.id),
    })),
    ...(orphans.length
      ? [{ key: 'unknown', title: 'Bước không còn trong pipeline', leads: orphans }]
      : []),
    { key: 'won', title: 'Thắng', leads: leads.filter((l) => l.status === 'won') },
    { key: 'lost', title: 'Thua', leads: leads.filter((l) => l.status === 'lost') },
  ];
}

const TIME = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});
export const timeText = (iso: string) => TIME.format(new Date(iso));
