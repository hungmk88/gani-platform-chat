// The list of #19 Thành viên (`GET /v1/members`, N153): members and invitations as the table says them. Team, own load limit,
// last sign-in, role change and 2FA reset are not in the API yet (N153 "Để sau"), so the table has no column for them.
import type { InfiniteData } from '@tanstack/react-query';

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
