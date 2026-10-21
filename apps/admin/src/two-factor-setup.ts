// Set-up of 2FA (#2 enrol, spec M8 §3.8, Q-U20-2): password → QR + 6 digits → 10 backup codes shown once.
// The secret (in totpURI) and the backup codes stay in the page's memory: never in a URL, storage or a log.

export const WRONG_PASSWORD = 'Mật khẩu không đúng.';
export const UNAVAILABLE = 'Không bật được 2FA lúc này. Thử lại sau ít phút.';

export type EnableResult =
  | { readonly kind: 'ok'; readonly totpURI: string; readonly backupCodes: readonly string[] }
  | { readonly kind: 'already_on' }
  | { readonly kind: 'error'; readonly message: string };

/** `POST /api/auth/two-factor/enable {password}`: 400 INVALID_PASSWORD or TOTP_ALREADY_ENABLED, else the URI and the codes. */
export async function readEnable(res: Response): Promise<EnableResult> {
  const body = (await res.json().catch(() => null)) as {
    totpURI?: unknown;
    backupCodes?: unknown;
    code?: unknown;
  } | null;
  if (res.ok) {
    const codes = body?.backupCodes;
    if (
      typeof body?.totpURI === 'string' &&
      Array.isArray(codes) &&
      codes.every((c): c is string => typeof c === 'string')
    )
      return { kind: 'ok', totpURI: body.totpURI, backupCodes: codes };
    return { kind: 'error', message: UNAVAILABLE };
  }
  if (body?.code === 'TOTP_ALREADY_ENABLED') return { kind: 'already_on' };
  if (body?.code === 'INVALID_PASSWORD') return { kind: 'error', message: WRONG_PASSWORD };
  return { kind: 'error', message: UNAVAILABLE };
}

/** The key to type by hand when the QR cannot be scanned, in groups of 4 like the prototype; empty if the URI has none. */
export function manualKey(totpURI: string): string {
  const secret = URL.canParse(totpURI) ? (new URL(totpURI).searchParams.get('secret') ?? '') : '';
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}

/** The text of the .txt download: the codes, one per line, with what they are for. */
export function backupCodesFile(codes: readonly string[]): string {
  return [
    'Mã dự phòng 2FA — Gani Platform',
    'Mỗi mã dùng 1 lần khi mất điện thoại.',
    '',
    ...codes,
    '',
  ].join('\n');
}
