// #8 Hồ sơ khách, gộp khách (J3, N204–N206, CEO brief 153): who sees what of the merges and how one line of them reads. The
// suggestions (`GET /v1/customers/{id}/merge-suggestions`) are for the roles that may merge; the history of the merges into a
// customer (`GET /v1/customers/{id}/merges`) only for an Owner or an Admin, who alone unmerge (N206: a Manager gets 403).
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';
import type { Role } from '../nav';
import { timeText } from '../tickets/tickets';
import type { Customer } from './customers';

export type MergeSuggestion = components['schemas']['CustomerMergeSuggestion'];
export type MergeSuggestionList = components['schemas']['CustomerMergeSuggestionList'];
export type MergeEntry = components['schemas']['CustomerMergeEntry'];
export type MergeList = components['schemas']['CustomerMergeList'];

/** Owner, Admin, Manager: the roles the API lets merge (N204); the others never ask (no 403 on the screen). */
export const maySeeSuggestions = (role: Role): boolean =>
  role === 'owner' || role === 'admin' || role === 'manager';

/** Owner, Admin: the roles that read the merges and unmerge (N206). */
export const maySeeMerges = (role: Role): boolean => role === 'owner' || role === 'admin';

const ofCustomer = (id: string) => `/v1/customers/${encodeURIComponent(id)}`;
export const suggestionsPath = (id: string): string => `${ofCustomer(id)}/merge-suggestions`;
export const mergesPath = (id: string): string => `${ofCustomer(id)}/merges`;

/** Why the API thinks two customers are one: the same phone or the same email, never a part of either. */
export const REASON: Readonly<Record<MergeSuggestion['reasons'][number], string>> = {
  phone: 'Trùng SĐT',
  email: 'Trùng email',
};

/** One merge into this customer in words: who was merged, by whom (a member without a name: the end of the id), when, undone. */
export function mergeLineOf(m: MergeEntry): {
  readonly source: string;
  readonly by: { readonly text: string; readonly title?: string };
  readonly at: string;
  readonly undone: string | null;
} {
  const name = m.mergedBy.name?.trim();
  return {
    source: m.sourceName?.trim() || 'Khách chưa có tên',
    by: name
      ? { text: name }
      : { text: `…${m.mergedBy.id.slice(-4)}`, title: 'Nhân viên chưa có tên' },
    at: timeText(m.mergedAt),
    undone: m.unmergedAt ? timeText(m.unmergedAt) : null,
  };
}

/** "Gộp…" for an Owner or an Admin only (CEO brief 153, 155): stricter than the API, which lets a Manager merge too (N204). To open
 * it to Managers later, change this line only. */
export const mayMerge = (role: Role): boolean => role === 'owner' || role === 'admin';

export type MergeResult = components['schemas']['CustomerMergeResult'];
type Person = Pick<Customer, 'id' | 'displayName' | 'phone' | 'email'>;

/** The kept profile's name, phone and email after the merge, as the API merges them: the merged one's fills only an empty field. */
export function mergePreview(
  kept: Person,
  merged: Person,
): Pick<Person, 'displayName' | 'phone' | 'email'> {
  return {
    displayName: kept.displayName ?? merged.displayName,
    phone: kept.phone ?? merged.phone,
    email: kept.email ?? merged.email,
  };
}

export const MERGE_WORD = 'GOP'; // typed to merge (CEO brief 155): ends trimmed, any case
export const confirmsMerge = (typed: string): boolean => typed.trim().toUpperCase() === MERGE_WORD;

/** Why a merge cannot go: the same customer on both sides (CEO brief 155 item 6); null when it can. */
export const sameCustomer = (keptId: string, mergedId: string): string | null =>
  keptId === mergedId ? 'Phải chọn hai khách khác nhau.' : null;

type Failure = { readonly text: string; readonly final: boolean };
const GONE = 'Một trong hai khách không còn (đã gộp hoặc đã xóa). Danh sách gợi ý đã tải lại.';
const UNSURE = 'Chưa rõ đã gộp hay chưa. Bấm Thử lại: an toàn, không gộp hai lần.';

/** What a refused or failed merge says (`final`: nothing left to try in the dialog, only "Đóng"). */
export function mergeFailureOf(e: Pick<ApiError, 'code' | 'status' | 'message'>): Failure {
  if (e.code === 'not_found') return { text: GONE, final: true };
  if (e.status === 403) return { text: e.message, final: true };
  const unsure = e.code === 'network_error' || e.status >= 500;
  return { text: unsure ? UNSURE : e.message, final: false };
}
