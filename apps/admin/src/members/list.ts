// The list of #19 Thành viên (`GET /v1/members`, N153): members and invitations as the table says them, and who may change whose
// role (N154) or reset whose second factor (N155). Team, own load limit and last sign-in are not in the API yet (N153 "Để sau").
import type { InfiniteData } from '@tanstack/react-query';

import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';
import type { Role } from '../nav';
import { invitableRoles, type Invitation } from './invite';

export type Member = components['schemas']['Member'];
type MemberPage = components['schemas']['MemberPage'];

export const PAGE_SIZE = 50;

export const membersPath = (cursor: string | null): string => {
  const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) p.set('cursor', cursor);
  return `/v1/members?${p.toString()}`;
};

/** Each status in words, with the colour of its badge (green/yellow/red for states only, CLAUDE.md). */
export const STATUS: Readonly<
  Record<Member['status'], readonly ['ok' | 'warn' | 'error', string]>
> = {
  active: ['ok', 'Đang hoạt động'],
  suspended: ['error', 'Tạm khóa'],
  pending: ['warn', 'Chờ nhận lời mời'],
  expired: ['error', 'Lời mời hết hạn'],
};

const TWO_FACTOR_REQUIRED: readonly Member['role'][] = ['owner', 'admin'];

/** The 2FA cell: nothing for an invitation, and "required" for an Owner or an Admin who has not set it up (U3). */
export function twoFactorOf(m: Pick<Member, 'status' | 'role' | 'twoFactorEnabled'>): {
  readonly text: string;
  readonly tone: 'ok' | 'error' | null;
} {
  if (m.status === 'pending' || m.status === 'expired') return { text: '—', tone: null };
  if (m.twoFactorEnabled) return { text: 'Đã bật', tone: 'ok' };
  return TWO_FACTOR_REQUIRED.includes(m.role)
    ? { text: 'Bắt buộc, chưa cài', tone: 'error' }
    : { text: 'Chưa bật', tone: null };
}

/** An invitation not taken can be sent again by whoever may invite its role (Phụ lục B, as resend-invite of the API). */
export const canResend = (actor: Role, m: Pick<Member, 'status' | 'role'>): boolean =>
  (m.status === 'pending' || m.status === 'expired') && invitableRoles(actor).includes(m.role);

/** The pages with the row of a renewed invitation brought up to date: pending again, with its new expiry. */
export function withRenewed(
  pages: InfiniteData<MemberPage> | undefined,
  i: Pick<Invitation, 'id' | 'expiresAt'>,
): InfiniteData<MemberPage> | undefined {
  if (!pages) return pages;
  return {
    ...pages,
    pages: pages.pages.map((p) => ({
      ...p,
      data: p.data.map((m) =>
        m.id === i.id ? { ...m, status: 'pending' as const, expiresAt: i.expiresAt } : m,
      ),
    })),
  };
}

/**
 * Who may change whose role (Phụ lục B, N154): an Owner anyone's but their own, an Admin anyone's but an Owner's and never to
 * Owner (`invitableRoles`). An invitation is not a member yet: it is invited again instead.
 */
export const canChangeRole = (
  actor: Role,
  meId: string,
  m: Pick<Member, 'status' | 'role' | 'userId'>,
): boolean =>
  (m.status === 'active' || m.status === 'suspended') &&
  m.userId !== meId &&
  invitableRoles(actor).includes(m.role);

/** The pages with one member replaced by the API's answer (a role changed). */
export function withMember(
  pages: InfiniteData<MemberPage> | undefined,
  member: Member,
): InfiniteData<MemberPage> | undefined {
  if (!pages) return pages;
  return {
    ...pages,
    pages: pages.pages.map((p) => ({
      ...p,
      data: p.data.map((m) => (m.id === member.id ? member : m)),
    })),
  };
}

/** The refusals of `PATCH /v1/members/{id}/role` in words of the screen; `last_owner` (N154) is not in the P9 table. */
export function roleError(error: ApiError): string {
  if (error.code === 'last_owner')
    return 'Công ty phải còn ít nhất một Owner đang hoạt động. Thêm Owner khác trước.';
  if (error.code === 'forbidden') return 'Bạn không đổi được vai trò này.';
  if (error.code === 'not_found')
    return 'Không tìm thấy thành viên này. Tải lại trang rồi thử lại.';
  return error.message;
}

/** Q-U20-1, N155: whoever may change the member's role may reset their second factor, once they have one; never their own. */
export const canResetTwoFactor = (
  actor: Role,
  meId: string,
  m: Pick<Member, 'status' | 'role' | 'userId' | 'twoFactorEnabled'>,
): boolean => m.twoFactorEnabled && canChangeRole(actor, meId, m);

export const MAX_REASON = 500;

/** Why the reason of a reset cannot be sent, or null: required, at most 500 characters (TwoFactorResetBody of the API). */
export function reasonProblem(raw: string): string | null {
  const reason = raw.trim();
  if (!reason) return 'Ghi lý do đặt lại (bắt buộc, lưu vào nhật ký).';
  if (reason.length > MAX_REASON) return `Lý do tối đa ${MAX_REASON} ký tự.`;
  return null;
}

/** The refusals of `POST /v1/members/{id}/2fa/reset`; `shared_account` (N155) is not in the P9 table. */
export function resetError(error: ApiError): string {
  if (error.code === 'shared_account')
    return 'Người này còn thuộc công ty khác hoặc là quản trị nền tảng: nhờ quản trị nền tảng đặt lại.';
  if (error.code === 'forbidden') return 'Bạn không đặt lại được 2FA của người này.';
  if (error.code === 'not_found') return roleError(error);
  return error.message;
}
