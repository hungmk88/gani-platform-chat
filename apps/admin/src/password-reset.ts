// "Quên mật khẩu" (PR7, N162): what /forgot-password and /reset-password do with the answers of /api/auth/password/*. The link of
// the email is BETTER_AUTH_URL/reset-password#token=…, its token in the fragment like an invitation's (src/invite.ts).
import { INVALID } from './invite';

export { INVALID };
export const INVALID_HELP = 'Xin link mới: link chỉ dùng được một lần và có hạn ngắn.';
export const SENT =
  'Nếu email này có tài khoản, link đặt lại mật khẩu đã được gửi tới đó. Link dùng được một lần, hạn ghi trong email.';
export const BAD_EMAIL = 'Email chưa đúng dạng.';
export const TOO_MANY = 'Thử quá nhiều lần. Đợi 1 phút rồi thử lại.';
export const UNAVAILABLE = 'Không gửi được yêu cầu lúc này. Thử lại sau ít phút.';

export type Forgot =
  { readonly kind: 'sent' } | { readonly kind: 'error'; readonly message: string };
export type Reset =
  | { readonly kind: 'ok' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'weak' }
  | { readonly kind: 'error'; readonly message: string };

const codeOf = async (res: Response): Promise<unknown> =>
  ((await res.json().catch(() => null)) as { code?: unknown } | null)?.code;

/** `POST /api/auth/password/forgot {email}`: 202 whether or not the address is a person's, so the page says the same either way. */
export async function readForgot(res: Response): Promise<Forgot> {
  if (res.ok) return { kind: 'sent' };
  if (res.status === 429) return { kind: 'error', message: TOO_MANY };
  if (res.status === 400 && (await codeOf(res)) === 'INVALID_EMAIL')
    return { kind: 'error', message: BAD_EMAIL };
  return { kind: 'error', message: UNAVAILABLE };
}

/** `POST /api/auth/password/reset {token, password}`: no session is made, every refusal of the token is one answer (404). */
export async function readReset(res: Response): Promise<Reset> {
  if (res.ok) return { kind: 'ok' };
  if (res.status === 404) return { kind: 'invalid' };
  if (res.status === 429) return { kind: 'error', message: TOO_MANY };
  if (res.status === 400 && (await codeOf(res)) === 'PASSWORD_TOO_WEAK') return { kind: 'weak' };
  return { kind: 'error', message: UNAVAILABLE };
}
