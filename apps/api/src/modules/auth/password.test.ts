import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashPassword, isStrongPassword, verifyPassword } from './password.js';

const fresh = () => randomBytes(12).toString('hex');

describe('hashPassword / verifyPassword', () => {
  it('makes an Argon2id hash with the agreed cost, and a different salt every time', async () => {
    const secret = fresh();
    const [a, b] = await Promise.all([hashPassword(secret), hashPassword(secret)]);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
  });

  it('accepts the right password and refuses a wrong one', async () => {
    const secret = fresh();
    const stored = await hashPassword(secret);
    expect(await verifyPassword({ hash: stored, password: secret })).toBe(true);
    expect(await verifyPassword({ hash: stored, password: fresh() })).toBe(false);
  });

  it.each(['', 'not-a-hash', '$argon2id$broken', '$2b$12$bcryptlookingvaluebcryptlookingvalue'])(
    'says false, without throwing, for the stored value %j',
    async (stored) => {
      expect(await verifyPassword({ hash: stored, password: fresh() })).toBe(false);
    },
  );
});

describe('isStrongPassword', () => {
  const filler = (n: number) => 'a'.repeat(n);

  it('wants 12 to 128 characters with a letter and a digit', () => {
    expect(isStrongPassword(`${filler(11)}1`)).toBe(true);
    expect(isStrongPassword(`${filler(10)}1`)).toBe(false);
    expect(isStrongPassword(`${filler(127)}1`)).toBe(true);
    expect(isStrongPassword(`${filler(128)}1`)).toBe(false);
  });

  it('refuses a password with no digit or no letter', () => {
    expect(isStrongPassword(filler(20))).toBe(false);
    expect(isStrongPassword('1'.repeat(20))).toBe(false);
  });
});
