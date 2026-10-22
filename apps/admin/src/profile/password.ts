// Changing one's password on #5 Hồ sơ cá nhân: the rule of ADR-003, checked before asking, and what each answer of Better Auth's
// /api/auth/change-password says. Better Auth checks the length (12–128) only, so letter and digit are checked here as well.

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;

/** Why the new password cannot be sent, or null. */
export function passwordProblem(current: string, next: string, again: string): string | null {
  if (!current) return 'Nhập mật khẩu hiện tại.';
  if (next.length < MIN_PASSWORD || next.length > MAX_PASSWORD)
    return `Mật khẩu mới cần từ ${MIN_PASSWORD} đến ${MAX_PASSWORD} ký tự.`;
  if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return 'Mật khẩu mới cần có cả chữ và số.';
  if (next === current) return 'Mật khẩu mới phải khác mật khẩu hiện tại.';
  if (next !== again) return 'Hai lần nhập mật khẩu mới chưa khớp.';
  return null;
}

export type ChangeResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'error'; readonly message: string };

/** The answer of POST /api/auth/change-password (Better Auth: `{ code, message }` on 4xx). */
export async function readChangePassword(res: Response): Promise<ChangeResult> {
  if (res.ok) return { kind: 'ok' };
  if (res.status === 401) return { kind: 'signed_out' };
  if (res.status === 429)
    return { kind: 'error', message: 'Thử quá nhiều lần. Đợi 1 phút rồi thử lại.' };
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  if (body?.code === 'INVALID_PASSWORD')
    return { kind: 'error', message: 'Mật khẩu hiện tại chưa đúng.' };
  if (body?.code === 'PASSWORD_TOO_SHORT' || body?.code === 'PASSWORD_TOO_LONG')
    return {
      kind: 'error',
      message: `Mật khẩu mới cần từ ${MIN_PASSWORD} đến ${MAX_PASSWORD} ký tự.`,
    };
  return { kind: 'error', message: 'Không đổi được mật khẩu lúc này. Thử lại sau ít phút.' };
}
