// #26 AI nội bộ, part A (CEO 01/11): the environment, E1/L1 and the monthly budget of the workspace being worked in, read only, from
// `GET /v1/workspaces/{id}/ai-settings`, a contract planned for S5 (docs/openapi/planned.json, #481, U61). A 404 keeps the one line
// the screen had: the prompt table is not hidden by it. Writing is B1 (E1/L1, budget; tier 1/2 only while `staging`), B2 (production,
// tier 3, waits for Q1).
import type { components } from '../api/planned';

export type AiSettings = components['schemas']['AiSettings'];

export const settingsPath = (workspaceId: string): string =>
  `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai-settings`;

export const ENVIRONMENT: Readonly<Record<AiSettings['environment'], string>> = {
  staging: 'Thử nghiệm (staging)',
  production: 'Chính thức (production)',
};

/** The features of Đợt 1, by their names in "Danh sách 109 tính năng". */
export const FEATURES: readonly (readonly [keyof AiSettings['features'], string])[] = [
  ['e1', 'Phân loại ý định và trích thông tin (E1)'],
  ['l1', 'Tóm tắt hội thoại (L1)'],
];

const USD = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'USD' });
export const usdText = (n: number): string => USD.format(n);

/**
 * What was spent of the budget, in words, with the state of BudgetGuard: it warns at 80 % and stops at 100 % (contract). A budget of
 * 0 has no share and no state: what it means is asked in U74.
 */
export function budgetOf(s: Pick<AiSettings, 'monthlyBudgetUsd' | 'usedThisMonthUsd'>): {
  readonly used: string;
  readonly tone: 'warn' | 'error' | null;
  readonly note: string | null;
} {
  const used = `${usdText(s.usedThisMonthUsd)} / ${usdText(s.monthlyBudgetUsd)}`;
  if (s.monthlyBudgetUsd <= 0) return { used, tone: null, note: null };
  const share = Math.floor((s.usedThisMonthUsd / s.monthlyBudgetUsd) * 100);
  const text = `${used} (${share} %)`;
  if (share >= 100)
    return {
      used: text,
      tone: 'error',
      note: 'Hết ngân sách tháng: AI nội bộ dừng, quay về kịch bản.',
    };
  if (share >= 80) return { used: text, tone: 'warn', note: 'Đã dùng từ 80 % ngân sách tháng.' };
  return { used: text, tone: null, note: null };
}

/**
 * When the month starts again, in the time zone of the workspace (the month of the budget is its month), named; without that zone,
 * in Viet Nam's time and said so, never passed off as the workspace's.
 */
export function resetText(resetsAt: string, timezone: string | null): string {
  const zone = timezone ?? 'Asia/Ho_Chi_Minh';
  const at = new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: zone,
  }).format(new Date(resetsAt));
  return `${at} (${timezone ? `múi giờ của workspace: ${timezone}` : 'giờ Việt Nam'})`;
}
