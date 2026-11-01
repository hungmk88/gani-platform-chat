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
export const FEATURES: readonly (readonly [FeatureKey, string])[] = [
  ['e1', 'Phân loại ý định và trích thông tin (E1)'],
  ['l1', 'Tóm tắt hội thoại (L1)'],
];

export type FeatureKey = keyof AiSettings['features'];

/**
 * B1 (CEO 01/11): turning E1/L1 on is tier 1/2 only while `staging`; in `production` it sends the customers' conversations to a
 * provider abroad, as B2 does: tier 3, not in this screen. Turning off is allowed anywhere (it sends less). Only `staging` is named,
 * so an environment added later is refused too.
 */
export const mayTurn = (environment: AiSettings['environment'], on: boolean): boolean =>
  !on || environment === 'staging';

export const PRODUCTION_LOCK =
  'Bật tính năng AI ở môi trường Chính thức cần phê duyệt riêng (tầng 3).';

/** The PATCH of one feature: only what changes (contract `AiSettingsChange`). */
export const featureBody = (key: FeatureKey, on: boolean) => ({ features: { [key]: on } });

export const MAX_BUDGET = 1_000_000;
const BUDGET_ZERO = '0 USD = AI nội bộ tắt hoàn toàn.';

/** The budget typed, as the API takes it (a number from 0 to 1 000 000, contract `AiSettingsChange`), or what is wrong. */
export function budgetValue(raw: string): number | string {
  const n = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(n) || n < 0 || n > MAX_BUDGET)
    return 'Nhập số tiền từ 0 đến 1.000.000 USD.';
  return n;
}

/**
 * What saving `budget` does at once (CEO 01/11), or null: 0 turns the internal AI off for good (not only until the month starts
 * again); at or under what was spent this month, it stops now, until `reset`.
 */
export function budgetStop(budget: number, used: number, reset: string): string | null {
  if (budget === 0) return BUDGET_ZERO;
  if (budget <= used)
    return `Ngân sách mới (${usdText(budget)}) không lớn hơn số đã dùng tháng này (${usdText(used)}): AI nội bộ sẽ dừng ngay tới ${reset}.`;
  return null;
}

const USD = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'USD' });
export const usdText = (n: number): string => USD.format(n);

/**
 * What was spent of the budget, in words, with the state of BudgetGuard: it warns at 80 % and stops at 100 % (contract). A budget of
 * 0 has no share: read as the contract says (BudgetGuard stops when spent ≥ budget), the internal AI is off (CEO 01/11; U74 asks BE).
 */
export function budgetOf(s: Pick<AiSettings, 'monthlyBudgetUsd' | 'usedThisMonthUsd'>): {
  readonly used: string;
  readonly tone: 'warn' | 'error' | null;
  readonly note: string | null;
} {
  const used = `${usdText(s.usedThisMonthUsd)} / ${usdText(s.monthlyBudgetUsd)}`;
  if (s.monthlyBudgetUsd <= 0) return { used, tone: 'error', note: BUDGET_ZERO };
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

/** A clock of `zone`, or null when the browser has no such zone: an empty or unknown name makes `Intl` throw a RangeError. */
function clockOf(zone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: zone,
    });
  } catch {
    return null;
  }
}

const VN_CLOCK = clockOf('Asia/Ho_Chi_Minh') as Intl.DateTimeFormat;

/**
 * When the month starts again, in the time zone of the workspace (the month of the budget is its month), named; without that zone,
 * or with one the browser does not know (the contract says a string, never null, yet old data or a zone newer than the browser's
 * may come), in Viet Nam's time and said so, never passed off as the workspace's.
 */
export function resetText(resetsAt: string, timezone: string | null): string {
  const own = timezone ? clockOf(timezone) : null;
  const at = (own ?? VN_CLOCK).format(new Date(resetsAt));
  return `${at} (${own ? `múi giờ của workspace: ${timezone}` : 'giờ Việt Nam'})`;
}
