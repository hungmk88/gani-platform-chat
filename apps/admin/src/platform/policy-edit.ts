// #30 Platform, PR 30b (CEO 05/11, brief 86, tầng 2): a new version of a channel policy, `PUT /v1/channel-policies/{id}` (planned
// S5, #610). Never an edit of a row: every field is sent, the form starts from the version in force. Checked as the API checks it
// (`ChannelPolicyChangeSchema`): `effectiveFrom` later than the version in force (else 422 invalid_effective_from), counts whole and
// not negative, `sourceUrl` null or not blank, `note` not blank once trimmed.
import type { components } from '../api/planned';
import { dayText, type ChannelPolicy } from './platform';

export type ChannelPolicyChange = components['schemas']['ChannelPolicyChange'];

/** The form as typed: the day it takes effect (00:00 in Viet Nam), the free window in hours, '' for none. */
export interface PolicyDraft {
  from: string;
  hours: string;
  quota: string;
  price: string;
  outside: boolean;
  sourceUrl: string;
  sourceDate: string;
  note: string;
}

export const policyPath = (id: string) => `/v1/channel-policies/${encodeURIComponent(id)}`;

/** The form as it opens: the version in force, no day yet (the new one needs a later day). */
export const draftOf = (p: ChannelPolicy): PolicyDraft => ({
  from: '',
  hours: p.freeWindowSeconds === null ? '' : String(p.freeWindowSeconds / 3600),
  quota: p.freeMessageQuota === null ? '' : String(p.freeMessageQuota),
  price: p.unitPriceVnd === null ? '' : String(p.unitPriceVnd),
  outside: p.outsideWindowAllowed,
  sourceUrl: p.sourceUrl ?? '',
  sourceDate: p.sourceDate ?? '',
  note: p.note,
});

/** 00:00 of that day in Viet Nam (+07:00, no daylight saving). */
export const startOf = (day: string) => `${day}T00:00:00+07:00`;

/** A whole number from 0, null when blank, undefined when it is not one. */
function whole(raw: string): number | null | undefined {
  const t = raw.trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : undefined;
}

/** The body to send, or the first problem in words. */
export function changeOf(d: PolicyDraft, current: ChannelPolicy): ChannelPolicyChange | string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.from)) return 'Chọn ngày hiệu lực.';
  const effectiveFrom = startOf(d.from);
  if (Date.parse(effectiveFrom) <= Date.parse(current.effectiveFrom))
    return `Ngày hiệu lực phải sau ${dayText(current.effectiveFrom)}, ngày của phiên bản đang dùng.`;
  const h = d.hours.trim();
  const seconds = !h ? null : /^\d+(\.\d+)?$/.test(h) ? Math.round(Number(h) * 3600) : undefined;
  if (seconds === undefined)
    return 'Khung miễn phí là số giờ (ví dụ 48), hoặc để trống nếu không có.';
  const quota = whole(d.quota);
  if (quota === undefined) return 'Số tin miễn phí là số nguyên từ 0, hoặc để trống.';
  const price = whole(d.price);
  if (price === undefined) return 'Giá là số đồng nguyên từ 0, hoặc để trống.';
  const note = d.note.trim();
  if (!note) return 'Ghi chú không được để trống.';
  return {
    effectiveFrom,
    freeWindowSeconds: seconds,
    freeMessageQuota: quota,
    unitPriceVnd: price,
    outsideWindowAllowed: d.outside,
    sourceUrl: d.sourceUrl.trim() || null,
    sourceDate: d.sourceDate || null,
    note,
  };
}

/** What the screen says once saved: a later day keeps the version in force in the table until then (the 200 says which). */
export const savedText = (sent: string, inForce: ChannelPolicy) =>
  `Đã thêm phiên bản có hiệu lực từ ${dayText(sent)}.${Date.parse(inForce.effectiveFrom) === Date.parse(sent) ? '' : ' Tới ngày đó bảng vẫn hiện phiên bản đang dùng.'} Đã ghi audit.`;
