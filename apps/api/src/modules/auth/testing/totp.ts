import { createHmac } from 'node:crypto';

// Test helper, not part of the build: the code an authenticator app shows (RFC 6238: SHA-1, 6 digits, 30 seconds).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function fromBase32(text: string): Buffer {
  const bits = [...text.replace(/=+$/, '')]
    .map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const bytes = Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
    parseInt(bits.slice(i * 8, i * 8 + 8), 2),
  );
  return Buffer.from(bytes);
}

/** The shared secret inside the otpauth:// address that /two-factor/enable returns. */
export const secretOf = (totpURI: string): string =>
  new URL(totpURI).searchParams.get('secret') ?? '';

export function totp(secret: string, at: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = (hmac[19] ?? 0) & 15;
  const value =
    (((hmac[offset] ?? 0) & 127) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(value % 1_000_000).padStart(6, '0');
}
