// #27 Tự chủ & feature flag, Đợt 1 read only (PR A, CEO 30/10): the autonomy level of the workspace being worked in
// (`GET /v1/workspaces/{id}/autonomy`) and its flags (`GET /v1/feature-flags?workspaceId=`), contracts planned for S5 (N167).
// Until the API serves them, the routes answer 404 and the screen says it is not there yet. Lowering the level and turning a
// flag off wait for PR B: S5 final, BE's answer on `available` and `not_in_phase`, and the CEO's design of the dialog.
import type { components } from '../api/planned';

export type Autonomy = components['schemas']['Autonomy'];
export type Level = Autonomy['level'];
export type FeatureFlag = components['schemas']['FeatureFlag'];
export type FeatureFlagList = components['schemas']['FeatureFlagList'];

export const autonomyPath = (workspaceId: string): string =>
  `/v1/workspaces/${encodeURIComponent(workspaceId)}/autonomy`;

export const flagsPath = (workspaceId: string): string =>
  `/v1/feature-flags?${new URLSearchParams({ workspaceId }).toString()}`;

/** What L0–L2 mean, in the words of prototype/dot1/autonomy.js; L3–L5 have no definition yet (U29). */
export const LEVELS: readonly (readonly [Level, string])[] = [
  ['L0', 'Bot kịch bản, AI không trả lời khách'],
  ['L1', 'AI trả lời khách chỉ từ Knowledge Base (Đợt 2)'],
  ['L2', 'AI được gọi tool, ví dụ tra giá (Đợt 2)'],
];
export const UNDEFINED_LEVEL = 'chưa có định nghĩa (U29)';

export const meaningOf = (level: Level): string =>
  LEVELS.find(([l]) => l === level)?.[1] ?? UNDEFINED_LEVEL;

const TIME = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/**
 * The last change in words: the API gives an id only, so the person is "Bạn" or "Người khác" (as the history of a ticket); a
 * level never changed says so. TẠM (U67): a change without an id says "Hệ thống" (the system lowers the level by itself, mục 26)
 * until BE says what `changedBy = null` means; approved for now by the CEO 30/10, not a decision.
 */
export function changeOf(a: Pick<Autonomy, 'changedBy' | 'changedAt'>, meId: string): string {
  if (!a.changedAt) return 'Chưa đổi lần nào';
  const who = a.changedBy === null ? 'Hệ thống' : a.changedBy === meId ? 'Bạn' : 'Người khác';
  return `${who}, ${TIME.format(new Date(a.changedAt))}`;
}

/** The state of a flag in words: locked in this phase first (it cannot be turned on in Đợt 1), then on or off. */
export const flagState = (f: Pick<FeatureFlag, 'enabled' | 'locked'>): string =>
  f.locked ? 'Khóa ở Đợt 1' : f.enabled ? 'Đang bật' : 'Đang tắt';
