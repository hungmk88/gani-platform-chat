import { hash, verify } from '@node-rs/argon2';

// Argon2id at the OWASP minimum (19 MiB, 2 passes, 1 lane): about 24 ms a hash, so a sign-in is not slow and many at once
// do not exhaust memory (N81). The algorithm is the library default; the test pins the `$argon2id$` prefix.
const PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

// ADR-003: at least 12 characters with a letter and a digit. The upper bound keeps one request from feeding Argon2 a huge input.
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export const hashPassword = (password: string): Promise<string> => hash(password, PARAMS);

/** True only for the right password. A stored hash that is malformed is "false" too: the caller learns nothing about why. */
export async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(data.hash, data.password);
  } catch {
    return false;
  }
}

export function isStrongPassword(password: string): boolean {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password)
  );
}
