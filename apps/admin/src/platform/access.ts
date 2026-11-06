// #30 Platform, "Phiên truy cập" (U79, brief A-U79, CEO 05/11, tầng 1): the access sessions of the platform operator who reads
// them (only their own), newest first by cursor, `GET /v1/platform/access-sessions` (planned S5, #617); opening one
// (`POST`, 60 minutes, a reason; PR U79b) and ending one early (`POST …/{id}/end`; an ended session comes back as it is).
import type { components } from '../api/planned';
import { timeText } from '../security/security';

export type AccessSession = components['schemas']['AccessSessionRecord'];
export type AccessSessionPage = components['schemas']['AccessSessionPage'];
export type AccessSessionCreate = components['schemas']['AccessSessionCreate'];
export type OpenedSession = components['schemas']['AccessSession'];

/** The sessions of one company or all, only those still running when `active`, 50 a page. */
export function sessionsPath(orgId: string, active: boolean, cursor: string | null): string {
  const p = new URLSearchParams({ limit: '50' });
  if (orgId) p.set('orgId', orgId);
  if (active) p.set('active', 'true');
  if (cursor) p.set('cursor', cursor);
  return `/v1/platform/access-sessions?${p.toString()}`;
}

/** The companies to choose from: the health list, which names every one (no other list for the operator). */
export const COMPANIES_PATH = '/v1/platform/tenants/health?limit=100';

export const CREATE_PATH = '/v1/platform/access-sessions';
export const endPath = (id: string) => `/v1/platform/access-sessions/${encodeURIComponent(id)}/end`;

/** Still running: not ended and not past its 60 minutes. */
export const running = (s: AccessSession, now: number) =>
  s.endedAt === null && Date.parse(s.expiresAt) > now;

/** How a session stands, in words. */
export function endText(s: AccessSession, now: number): string {
  if (s.endReason === 'manual' && s.endedAt) return `Đã kết thúc lúc ${timeText(s.endedAt)}`;
  if (running(s, now)) return `Còn hiệu lực tới ${timeText(s.expiresAt)}`;
  return `Hết hạn lúc ${timeText(s.expiresAt)}`;
}

export const MIN_REASON = 10;
export const MAX_REASON = 500;

/**
 * The reason as the API counts it (`z.string().trim().normalize('NFC').min(10).max(500)`, 400 `validation_failed` otherwise):
 * trimmed, in NFC, 10 to 500 UTF-16 units as zod counts (an emoji is two).
 */
export function reasonProblem(raw: string): string | null {
  const n = raw.trim().normalize('NFC').length;
  if (n < MIN_REASON)
    return `Ghi lý do cụ thể (ít nhất ${MIN_REASON} ký tự), ví dụ số yêu cầu hỗ trợ.`;
  if (n > MAX_REASON) return `Lý do tối đa ${MAX_REASON} ký tự.`;
  return null;
}

export const createBodyOf = (orgId: string, reason: string): AccessSessionCreate => ({
  orgId,
  reason: reason.trim(),
});
