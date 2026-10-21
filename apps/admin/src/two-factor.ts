// The second step of sign-in (#2, verify): what the screen says for each answer of Better Auth's two-factor plugin.

export const WRONG_CODE =
  'Mã không đúng hoặc đã hết hạn. Kiểm tra giờ trên điện thoại rồi thử lại.';
export const WRONG_BACKUP_CODE = 'Mã dự phòng không đúng hoặc đã dùng.';
export const LOCKED = 'Tạm khóa 30 phút vì nhập sai mã 5 lần.';
export const EXPIRED = 'Phiên đăng nhập đã hết hạn. Đăng nhập lại.';
export const TOO_MANY = 'Thử quá nhiều lần. Đợi 1 phút rồi thử lại.';
export const UNAVAILABLE = 'Không xác thực được lúc này. Thử lại sau ít phút.';

export type CodeKind = 'totp' | 'backup';
export type VerifyResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly message: string; readonly restart: boolean };

/** The endpoint of each kind of code (Brief UI: 6 digits from the app, or one of the 10 backup codes). */
export const VERIFY_PATH: Record<CodeKind, string> = {
  totp: '/api/auth/two-factor/verify-totp',
  backup: '/api/auth/two-factor/verify-backup-code',
};

/** `restart`: the pending sign-in is gone (cookie expired or missing), so the person must sign in again from /login. */
export async function readVerify(res: Response, kind: CodeKind): Promise<VerifyResult> {
  if (res.ok) return { kind: 'ok' };
  const code = ((await res.json().catch(() => null)) as { code?: unknown } | null)?.code;
  const error = (message: string, restart = false): VerifyResult => ({
    kind: 'error',
    message,
    restart,
  });
  if (code === 'ACCOUNT_TEMPORARILY_LOCKED') return error(LOCKED);
  if (code === 'INVALID_TWO_FACTOR_COOKIE') return error(EXPIRED, true);
  if (code === 'INVALID_CODE' || code === 'INVALID_BACKUP_CODE')
    return error(kind === 'totp' ? WRONG_CODE : WRONG_BACKUP_CODE);
  if (res.status === 429) return error(TOO_MANY);
  return error(UNAVAILABLE);
}
