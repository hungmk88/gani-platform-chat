// #12 Pipeline lead (CEO 02/11, brief 28–30): read only, on a DRAFT contract. It is NOT in docs/openapi/planned.json nor
// openapi.json: the types below are written by hand after the shape a BE brief of 02/11 gives (docs/ui/lead-shape-from-be.md:
// not in the repo, BE to confirm), to be replaced by the generated ones when BE publishes the Lead contract. Until the API serves
// the routes, they answer 404 and the screen says it is not there yet.
// - `GET /v1/leads`: Brief P9 (line 443); its query (workspaceId, cursor, limit) and the page around the leads are FE's guess.
// - `GET /v1/workspaces/{id}/pipeline`: from the BE brief of 02/11 (brief 30 (3)), not in P9 nor docs/ui/endpoint-M8.md; its
//   answer `{ data: [{ id, name }] }` is FE's guess.
// The names of the steps and the reasons a lead is lost come from the API only: Q9 has not settled them, none is written here.

/** A step of the workspace's pipeline, as the API names it; the steps come in the order of the pipeline. */
export interface PipelineStage {
  readonly id: string;
  readonly name: string;
}
export interface Pipeline {
  readonly data: readonly PipelineStage[];
}

/** Open, or closed as won or lost (U6: Thắng/Thua are not steps; `POST /v1/leads/{id}/close`, P9). */
export type LeadStatus = 'open' | 'won' | 'lost';
/** The fields of the BE brief of 02/11, no more; which may be null is FE's guess (lead-shape-from-be.md §3). */
export interface Lead {
  readonly id: string;
  readonly workspaceId: string;
  readonly customer: { readonly id: string; readonly displayName: string | null } | null;
  readonly conversationId: string | null;
  readonly title: string;
  /** The step the lead is at, or was at when it was closed. */
  readonly stage: PipelineStage;
  readonly status: LeadStatus;
  readonly owner: { readonly id: string; readonly name: string | null } | null;
  readonly lostReason: string | null;
  readonly closedAt: string | null;
  readonly score: null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface LeadPage {
  readonly data: readonly Lead[];
  readonly nextCursor: string | null;
}

/** `GET /v1/leads` of the workspace, by cursor (P9). */
export function leadsPath(workspaceId: string, cursor: string | null): string {
  const p = new URLSearchParams({ workspaceId, limit: '100' });
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
