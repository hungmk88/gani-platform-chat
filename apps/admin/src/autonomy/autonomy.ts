// #27 Tự chủ & feature flag, Đợt 1 read only (PR A, CEO 30/10): the autonomy level of the workspace being worked in
// (`GET /v1/workspaces/{id}/autonomy`) and its flags (`GET /v1/feature-flags?workspaceId=`), contracts planned for S5 (N167).
// Until the API serves them, the routes answer 404 and the screen says it is not there yet. PR B (CEO 05/11, brief 61): lowering
// the level (`PATCH`, Owner or Admin, Phụ lục B) in a dialog of two steps; turning a flag off still waits.
import type { ApiError } from '../api/errors';
import type { components } from '../api/planned';

export type Autonomy = components['schemas']['Autonomy'];
export type Level = Autonomy['level'];
export type FeatureFlag = components['schemas']['FeatureFlag'];
export type FeatureFlagList = components['schemas']['FeatureFlagList'];
export type AutonomyChange = components['schemas']['AutonomyChange'];

export const autonomyPath = (workspaceId: string): string =>
  `/v1/workspaces/${encodeURIComponent(workspaceId)}/autonomy`;

export const flagsPath = (workspaceId: string): string =>
  `/v1/feature-flags?${new URLSearchParams({ workspaceId }).toString()}`;

/** What L0–L2 mean, in the words of prototype/dot1/autonomy.js; L3–L5 have no definition yet (U29). L1 is of Đợt 1 (U29). */
export const LEVELS: readonly (readonly [Level, string])[] = [
  ['L0', 'Bot kịch bản, AI không trả lời khách'],
  ['L1', 'AI trả lời khách chỉ từ Knowledge Base'],
  ['L2', 'AI được gọi tool, ví dụ tra giá (Đợt 2)'],
];
export const UNDEFINED_LEVEL = 'chưa có định nghĩa (U29)';

export const meaningOf = (level: Level): string =>
  LEVELS.find(([l]) => l === level)?.[1] ?? UNDEFINED_LEVEL;

/** Every level, lowest first; from L2 on they wait for Đợt 2 (U29, CEO 26/10). */
export const ALL_LEVELS: readonly Level[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
const LATER = ALL_LEVELS.indexOf('L2');

/**
 * The levels of "Hạ mức tự chủ" (CEO 05/11, brief 61) with why each cannot be chosen, null when it can: only one below the
 * current level that the API offers (`available`); L2–L5 always "Chờ Đợt 2". Raising (the Owner's) is not in this dialog.
 */
export function lowerChoices(a: Pick<Autonomy, 'level' | 'available'>) {
  const now = ALL_LEVELS.indexOf(a.level);
  return ALL_LEVELS.map((level, i) => ({
    level,
    why:
      i === now
        ? 'Mức hiện tại'
        : i >= LATER
          ? 'Chờ Đợt 2'
          : i > now
            ? 'Cao hơn mức hiện tại'
            : a.available.includes(level)
              ? null
              : 'Chưa chọn được',
  }));
}

export const MAX_REASON = 500;

/** Why the reason cannot be sent, or null: required, 1–500 characters once trimmed (AutonomyChange). */
export function lowerReasonProblem(raw: string): string | null {
  const reason = raw.trim();
  if (!reason) return 'Ghi lý do hạ mức (bắt buộc, ghi audit).';
  if (reason.length > MAX_REASON) return `Lý do tối đa ${MAX_REASON} ký tự.`;
  return null;
}

/** The refusals of the PATCH in words; a 403 is about who may lower it, the rest as `errors.ts` (409 `not_in_phase` there). */
export const lowerError = (e: ApiError): string =>
  e.code === 'forbidden' ? 'Chỉ Owner hoặc Admin hạ được mức tự chủ.' : e.message;

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
