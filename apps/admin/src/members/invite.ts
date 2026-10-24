// Inviting a member on #19 Thành viên (N152): who may invite which role (Phụ lục B, as members.permissions.ts of the API), the email
// as the API stores it, and what each answer of `POST /v1/members/invite` and of resend-invite says.
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';
import { ROLES, type Role } from '../nav';

export type Invitation = components['schemas']['Invitation'];
export type OrgRole = components['schemas']['InviteBody']['role'];

/** The roles of a company, in the order of ROLES (src/nav.ts): every role but platform_operator. */
const ORG_ROLES = ROLES.filter((r): r is OrgRole => r !== 'platform_operator');

/** Phụ lục B "Mời thành viên, đổi vai trò": an Owner invites any role, an Admin any but Owner, nobody else invites. */
export function invitableRoles(actor: Role): OrgRole[] {
  const all = [...ORG_ROLES];
  if (actor === 'owner') return all;
  if (actor === 'admin') return all.filter((r) => r !== 'owner');
  return [];
}

export const MAX_EMAIL = 254;

/** The email as the API keeps it (trimmed, lower case), or why it cannot be sent. */
export function emailOf(
  raw: string,
):
  { readonly ok: true; readonly email: string } | { readonly ok: false; readonly problem: string } {
  const email = raw.trim().toLowerCase();
  if (!email) return { ok: false, problem: 'Nhập email của người được mời.' };
  if (email.length > MAX_EMAIL || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { ok: false, problem: 'Email chưa đúng dạng, ví dụ ten@congty.vn.' };
  return { ok: true, email };
}

const EXPIRES = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/** The end of an invitation link in Vietnam time: always the API's `expiresAt`, never a constant here (U1). */
export const expiryOf = (iso: string): string => EXPIRES.format(new Date(iso));

/** What the person reads once the invitation exists. */
export function invitedText(i: Pick<Invitation, 'email' | 'expiresAt' | 'emailSent'>): string {
  const until = expiryOf(i.expiresAt);
  return i.emailSent
    ? `Đã gửi lời mời tới ${i.email}. Link dùng được đến ${until}.`
    : `Đã tạo lời mời cho ${i.email} nhưng chưa gửi được email. Lời mời vẫn còn đến ${until}; bấm Gửi lại lời mời để thử lại.`;
}

/** The refusals this screen says in its own words; the rest keep the sentence of the P9 table. */
export function inviteError(error: ApiError): string {
  if (error.code === 'duplicate_resource') return 'Email này đang có lời mời chờ nhận.';
  if (error.code === 'forbidden') return 'Bạn không mời được vai trò này.';
  if (error.code === 'validation_failed') return 'Email hoặc vai trò chưa hợp lệ.';
  if (error.code === 'not_found')
    return 'Lời mời này không còn chờ nhận: đã được nhận hoặc đã hết hiệu lực.';
  return error.message;
}
