// #17 Danh sách bot flow and its detail (D1a3a #496, CEO 01/11: Đợt 1, read only), real API: `GET /v1/bot-flows?workspaceId=`
// (the live flows of a workspace, last changed first, at most 200, no cursor) and `GET /v1/bot-flows/{id}` (draft + published).
import type { components } from '../api/schema';

export type BotFlow = components['schemas']['BotFlow'];
export type BotFlowList = components['schemas']['BotFlowList'];
export type BotFlowDetail = components['schemas']['BotFlowDetail'];
type BotGraph = components['schemas']['BotGraph'];

/** The most flows the list answers (openapi.json); whether a full list leaves older flows out is U77 (c). */
export const MAX_FLOWS = 200;

export const flowsPath = (workspaceId: string) =>
  `/v1/bot-flows?${new URLSearchParams({ workspaceId }).toString()}`;
export const flowPath = (id: string) => `/v1/bot-flows/${encodeURIComponent(id)}`;

/** The three states in words, with the colour of the running and the paused ones (colours only for states). */
export const STATUS: Readonly<Record<BotFlow['status'], readonly [string, 'ok' | 'warn' | null]>> =
  {
    draft: ['Nháp, chưa xuất bản', null],
    active: ['Đang chạy', 'ok'],
    inactive: ['Tạm dừng', 'warn'],
  };

const TIME = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});
export const timeText = (iso: string) => TIME.format(new Date(iso));

/** The version published last, or that none was. */
export const publishedText = (version: number | null) =>
  version === null ? 'Chưa xuất bản' : `Phiên bản ${version}`;

/** The size of a graph in words: its steps (nodes) and the lines between them (edges). */
export const sizeText = (g: BotGraph) => `${g.nodes.length} bước, ${g.edges.length} đường nối`;

// Object keys sorted at every depth, so two equal configs compare equal whatever order the API writes their keys in.
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
const graphKey = (g: BotGraph) =>
  JSON.stringify(
    canonical({
      nodes: [...g.nodes].sort((a, b) => (a.key < b.key ? -1 : 1)),
      edges: g.edges.map((e) => `${e.from}\u0000${e.to}\u0000${e.label ?? ''}`).sort(),
    }),
  );

/** What the draft holds against the version published last (publishing copies its graph into a new draft, D1a3b). */
export function draftText(f: Pick<BotFlowDetail, 'draft' | 'published'>): string {
  if (f.draft.graph.nodes.length === 0) return 'Bản nháp trống: chưa có bước nào.';
  if (!f.published) return 'Chưa xuất bản lần nào.';
  return graphKey(f.draft.graph) === graphKey(f.published.graph)
    ? 'Giống bản đã xuất bản.'
    : 'Có thay đổi chưa xuất bản.';
}
