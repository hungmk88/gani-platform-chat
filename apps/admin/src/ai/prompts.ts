// #26 AI nội bộ, Đợt 1 only E20 (U35, CEO 30/10): the versions of the prompts the internal AI uses, read only, from
// `GET /v1/ai/prompts`, a contract planned for S5 (docs/openapi/planned.json, N167). Until the API serves it, the route answers 404
// and the screen says it is not there yet. Environment, features and budget: `settings.ts` (part A, U61).
import type { components } from '../api/planned';
import type { Role } from '../nav';

export type PromptVersion = components['schemas']['PromptVersion'];
export type PromptVersionList = components['schemas']['PromptVersionList'];

export const PROMPTS_PATH = '/v1/ai/prompts';

/**
 * TẠM (U66): Phụ lục B has no row for reading the prompt versions (row 41 is "Bật/tắt AI nội bộ, ngân sách AI"). Owner and Admin
 * until U66 is answered, as the planned 403 and the menu. Not a decision: change it with the answer, not before.
 */
export const mayReadPrompts = (role: Role | null): boolean => role === 'owner' || role === 'admin';

const DAY = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/** When and by whom a version was approved, in words; one not approved says so instead of a date. */
export function approvalOf(p: Pick<PromptVersion, 'approvedAt' | 'approvedBy'>): {
  readonly when: string;
  readonly who: string;
} {
  return {
    when: p.approvedAt ? DAY.format(new Date(p.approvedAt)) : 'Chưa duyệt',
    who: p.approvedBy ?? '—',
  };
}
