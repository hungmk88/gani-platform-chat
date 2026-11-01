// #17 Danh sách bot flow (D1a3a #496, CEO 01/11: Đợt 1, read only), real API: `GET /v1/bot-flows?workspaceId=`, the live flows
// of a workspace, last changed first, at most 200, no cursor. The detail of a flow (`GET /v1/bot-flows/{id}`) is part A2.
import type { components } from '../api/schema';

export type BotFlow = components['schemas']['BotFlow'];
export type BotFlowList = components['schemas']['BotFlowList'];

/** The most flows the list answers (openapi.json); whether a full list leaves older flows out is U77 (c). */
export const MAX_FLOWS = 200;

export const flowsPath = (workspaceId: string) =>
  `/v1/bot-flows?${new URLSearchParams({ workspaceId }).toString()}`;

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
