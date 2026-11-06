// #30 Platform (U28, PR 30a, CEO 05/11, brief 79: (c)), read only, the platform operator only: the health of every company
// (`GET /v1/platform/tenants/health`, by cursor) and the channel policies in force (`GET /v1/channel-policies`), contracts planned
// for S5 (#610, U65). Until the API serves them they answer 404 and the tab says it is not there yet. The access sessions tab:
// `access.ts` (U79, #617).
import type { components } from '../api/planned';

export type TenantHealth = components['schemas']['TenantHealth'];
export type TenantHealthPage = components['schemas']['TenantHealthPage'];
export type ChannelPolicy = components['schemas']['ChannelPolicy'];
export type ChannelPolicyList = components['schemas']['ChannelPolicyList'];

/** The three tabs of the prototype (U28), by `?tab=` as /me; the health of the companies first. */
export const TABS = [
  ['health', 'Sức khỏe công ty'],
  ['access', 'Phiên truy cập'],
  ['policies', 'Chính sách kênh'],
] as const;
export type Tab = (typeof TABS)[number][0];

/** The tab a URL asks for; anything else is the first one. */
export const tabOf = (raw: string | undefined): Tab =>
  TABS.find(([k]) => k === raw)?.[0] ?? 'health';

/** The companies, 50 a page (the contract's default, at most 100). */
export function healthPath(cursor: string | null): string {
  const p = new URLSearchParams({ limit: '50' });
  if (cursor) p.set('cursor', cursor);
  return `/v1/platform/tenants/health?${p.toString()}`;
}

export const POLICIES_PATH = '/v1/channel-policies';

/** The classes of message as the prototype names them. */
export const MESSAGE_CLASS: Readonly<Record<ChannelPolicy['messageClass'], string>> = {
  advisory: 'Tư vấn',
  transaction: 'Giao dịch',
  broadcast: 'Truyền thông',
};

/** The free window: "48 giờ, 8 tin"; a part the policy leaves `null` is not said, neither at all is "—". */
export function windowText(p: Pick<ChannelPolicy, 'freeWindowSeconds' | 'freeMessageQuota'>) {
  const s = p.freeWindowSeconds;
  const parts = [
    s === null ? null : s % 3600 === 0 ? `${s / 3600} giờ` : `${Math.round(s / 60)} phút`,
    p.freeMessageQuota === null ? null : `${p.freeMessageQuota} tin`,
  ].filter((x) => x !== null);
  return parts.length ? parts.join(', ') : '—';
}

const VND = new Intl.NumberFormat('vi-VN');

/** The price of one message outside the free part, or "—" when the policy has none. */
export const priceText = (vnd: number | null) => (vnd === null ? '—' : `${VND.format(vnd)} đ/tin`);

const DAY = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/** A day of the API (a date-time, or a date `YYYY-MM-DD` read as noon UTC so that no time zone moves it), dd/mm/yyyy. */
export const dayText = (iso: string | null) =>
  iso === null ? '—' : DAY.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));

/** The source of a policy as a link only when it is an https URL; anything else is shown as text, never followed. */
export function sourceLink(url: string | null): { href: string; text: string } | null {
  if (!url?.startsWith('https://')) return null;
  try {
    return { href: url, text: new URL(url).hostname };
  } catch {
    return null;
  }
}
