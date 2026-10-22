// Inviting a member on #19 Thành viên (N152): who may invite which role (Phụ lục B, as members.permissions.ts of the API), the email
// as the API stores it, and what each answer of `POST /v1/members/invite` says. The list of members waits for `GET /v1/members`.
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';
import type { Role } from '../nav';

export type Invitation = components['schemas']['Invitation'];
export type OrgRole = components['schemas']['InviteBody']['role'];

/** The roles of a company in the order of the menu of the form, with the names people read (prototype, Phụ lục B). */
export const ROLE_NAME: Readonly<Record<OrgRole, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  sales: 'Sales',
  support: 'Support',
  marketing: 'Marketing',
  viewer: 'Viewer',
};

/** Phụ lục B "Mời thành viên, đổi vai trò": an Owner invites any role, an Admin any but Owner, nobody else invites. */
export function invitableRoles(actor: Role): OrgRole[] {
  const all = Object.keys(ROLE_NAME) as OrgRole[];
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

/** What the person reads once the invitation exists: the expiry is the API's, never a constant here (U1). */
export function invitedText(i: Pick<Invitation, 'email' | 'expiresAt' | 'emailSent'>): string {
  const until = EXPIRES.format(new Date(i.expiresAt));
  return i.emailSent
    ? `Đã gửi lời mời tới ${i.email}. Link dùng được đến ${until}.`
    : `Đã tạo lời mời cho ${i.email} nhưng chưa gửi được email. Lời mời vẫn còn đến ${until}; gửi lại khi có nút Gửi lại.`;
}

/** The refusals this screen says in its own words; the rest keep the sentence of the P9 table. */
export function inviteError(error: ApiError): string {
  if (error.code === 'duplicate_resource') return 'Email này đang có lời mời chờ nhận.';
  if (error.code === 'forbidden') return 'Bạn không mời được vai trò này.';
  if (error.code === 'validation_failed') return 'Email hoặc vai trò chưa hợp lệ.';
  return error.message;
}
