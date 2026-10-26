// #16 Tổng quan (U29, CEO 26/10/2026): the five cards of Đợt 1 from `GET /v1/overview?workspaceId=`, a contract planned for S5
// (docs/openapi/planned.json, N167). Until the API serves it, the route answers 404 and the screen says it is not there yet.
import type { components } from '../api/planned';

export type Overview = components['schemas']['Overview'];

export const overviewPath = (workspaceId: string): string =>
  `/v1/overview?${new URLSearchParams({ workspaceId }).toString()}`;

/** A duration as people say it: `45 giây`, `3 phút 40 giây`, `1 giờ 5 phút`. */
export function durationText(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} phút ${s % 60} giây` : `${m} phút`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} giờ ${m % 60} phút` : `${h} giờ`;
}

export interface Card {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  /** A state colour (CLAUDE.md: green/yellow/red only for states): waiting or over SLA when there are some. */
  readonly tone: 'warn' | 'error' | null;
}

/**
 * The cards of the figures: five for the workspace, four for "what I hold" (scope `me`, Sales and Support: no agent card). A figure
 * the API cannot give yet (null) says why instead of a number.
 */
export function cardsOf(o: Overview): Card[] {
  const mine = o.scope === 'me';
  const cards: Card[] = [
    {
      label: mine ? 'Hội thoại tôi đang giữ' : 'Hội thoại đang mở',
      value: String(o.openConversations),
      note: 'Chưa đóng',
      tone: null,
    },
    {
      label: 'Chờ nhân viên nhận',
      value: String(o.waitingForAgent),
      note: 'Trong hàng chờ',
      tone: o.waitingForAgent > 0 ? 'warn' : null,
    },
    {
      label: 'Phản hồi đầu tiên (P90)',
      value:
        o.firstResponseP90Seconds === null ? 'Chưa có' : durationText(o.firstResponseP90Seconds),
      note:
        o.firstResponseP90Seconds === null
          ? 'Hôm nay chưa có hội thoại nào được trả lời'
          : '90% hội thoại hôm nay được trả lời trong khoảng này',
      tone: null,
    },
    {
      label: 'Quá hạn SLA',
      value: o.overSla === null ? 'Chưa tính' : String(o.overSla),
      note: o.overSla === null ? 'Chờ cấu hình SLA của workspace' : 'Hội thoại đang mở đã quá hạn',
      tone: o.overSla ? 'error' : null,
    },
  ];
  if (!mine && o.agentsOnline !== null && o.agentsTotal !== null)
    cards.push({
      label: 'Nhân viên trực tuyến',
      value: `${o.agentsOnline} / ${o.agentsTotal}`,
      note: 'Đang trực tuyến / tổng số người giữ hội thoại',
      tone: null,
    });
  return cards;
}

const TIME = new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' });

/** When the figures were computed, in Viet Nam's time. */
export const updatedAt = (o: Pick<Overview, 'generatedAt'>): string =>
  TIME.format(new Date(o.generatedAt));
