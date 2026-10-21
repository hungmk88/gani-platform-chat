// What the sign-in screens do with the answers of Better Auth (/api/auth) and of GET /v1/me/security-status.

/** Wrong password and an account locked for 30 minutes get the same answer from the API, so they get the same sentence here. */
export const WRONG_CREDENTIALS =
  'Email hoặc mật khẩu không đúng. Nhập sai 5 lần liên tiếp, tài khoản tạm khóa 30 phút.';
export const TOO_MANY_REQUESTS = 'Thử quá nhiều lần. Đợi 1 phút rồi thử lại.';
export const UNAVAILABLE = 'Không đăng nhập được lúc này. Thử lại sau ít phút.';

export type SignInResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'two_factor' }
  | { readonly kind: 'error'; readonly message: string };

/** `POST /api/auth/sign-in/email`: the session cookie is set by the server; nothing of the body is kept. */
export async function readSignIn(res: Response): Promise<SignInResult> {
  const body = (await res.json().catch(() => null)) as { twoFactorRedirect?: unknown } | null;
  if (res.ok) return body?.twoFactorRedirect === true ? { kind: 'two_factor' } : { kind: 'ok' };
  if (res.status === 401) return { kind: 'error', message: WRONG_CREDENTIALS };
  if (res.status === 429) return { kind: 'error', message: TOO_MANY_REQUESTS };
  return { kind: 'error', message: UNAVAILABLE };
}

export type SecurityStatus =
  | { readonly kind: 'signed_in'; readonly twoFactorEnabled: boolean }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'must_set_up' }
  | { readonly kind: 'error'; readonly status: number; readonly traceId: string | null };

/** `GET /v1/me/security-status` (N89): open to a person who has not set up 2FA yet, so it is asked before anything else. */
export async function readSecurityStatus(res: Response): Promise<SecurityStatus> {
  const body = (await res.json().catch(() => null)) as {
    mustSetUp?: unknown;
    twoFactorEnabled?: unknown;
    traceId?: unknown;
  } | null;
  if (res.ok && typeof body?.mustSetUp === 'boolean' && typeof body.twoFactorEnabled === 'boolean')
    return body.mustSetUp
      ? { kind: 'must_set_up' }
      : { kind: 'signed_in', twoFactorEnabled: body.twoFactorEnabled };
  if (res.status === 401) return { kind: 'signed_out' };
  return {
    kind: 'error',
    status: res.ok ? 502 : res.status,
    traceId: typeof body?.traceId === 'string' ? body.traceId : null,
  };
}
