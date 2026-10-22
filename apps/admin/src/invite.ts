// #4 Nhận lời mời (N151, prototype/dot1/invite.js): what the page does with the link and the answers of /api/auth/invite/*.
// The token comes in the fragment (#token=…), which no server sees; the page keeps it in memory and takes it out of the address bar.

/** Every refusal of a token (expired, used, withdrawn, an account that must sign in first) is this one answer of the API. */
export const INVALID = 'Link không hợp lệ hoặc đã hết hạn.';
export const INVALID_HELP =
  'Nhờ người mời gửi lại link mới. Nếu email này đã có tài khoản, đăng nhập trước rồi mở lại link.';
export const TOO_MANY = 'Thử quá nhiều lần. Đợi 1 phút rồi mở lại link.';
export const UNAVAILABLE = 'Không nhận được lời mời lúc này. Thử lại sau ít phút.';
export const MISMATCH = 'Hai lần nhập mật khẩu chưa khớp.';
export const WEAK = 'Mật khẩu cần ít nhất 12 ký tự, có chữ và số.';

/** The token of `#token=…`, or null when the link has none or it cannot be one (the API's rule: 20–128 of base64url). */
export function tokenOf(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && /^[A-Za-z0-9_-]{20,128}$/.test(token) ? token : null;
}

/** ADR-003, as the API checks it (isStrongPassword): 12 to 128 characters, a letter and a digit. */
export const isStrongPassword = (password: string): boolean =>
  password.length >= 12 &&
  password.length <= 128 &&
  /[A-Za-z]/.test(password) &&
  /\d/.test(password);

/** The roles the API makes set up a second factor before anything else (N89, N93). */
export const needsTwoFactor = (role: string): boolean => role === 'owner' || role === 'admin';

export type Refusal =
  { readonly kind: 'invalid' } | { readonly kind: 'error'; readonly message: string };
export type Lookup =
  { readonly kind: 'ok'; readonly invitedEmail: string; readonly role: string } | Refusal;
export type Accept = { readonly kind: 'ok' } | { readonly kind: 'weak' } | Refusal;

function refusal(res: Response): Refusal {
  if (res.status === 404) return { kind: 'invalid' };
  return { kind: 'error', message: res.status === 429 ? TOO_MANY : UNAVAILABLE };
}

/** `POST /api/auth/invite/lookup {token}` → the invited email and role. */
export async function readLookup(res: Response): Promise<Lookup> {
  if (!res.ok) return refusal(res);
  const body = (await res.json().catch(() => null)) as {
    invitedEmail?: unknown;
    role?: unknown;
  } | null;
  return typeof body?.invitedEmail === 'string' && typeof body.role === 'string'
    ? { kind: 'ok', invitedEmail: body.invitedEmail, role: body.role }
    : { kind: 'error', message: UNAVAILABLE };
}

/** `POST /api/auth/invite/accept {token, password?, name?}`: the session cookie is set by the server; nothing of the body is kept. */
export async function readAccept(res: Response): Promise<Accept> {
  if (res.ok) return { kind: 'ok' };
  const code = ((await res.json().catch(() => null)) as { code?: unknown } | null)?.code;
  if (res.status === 400 && code === 'PASSWORD_TOO_WEAK') return { kind: 'weak' };
  return refusal(res);
}
