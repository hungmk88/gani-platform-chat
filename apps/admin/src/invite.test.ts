import { describe, expect, it } from 'vitest';

import {
  isStrongPassword,
  needsTwoFactor,
  readAccept,
  readLookup,
  tokenOf,
  TOO_MANY,
  UNAVAILABLE,
} from './invite';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const TOKEN = 'a'.repeat(43);

describe('tokenOf', () => {
  it('reads the token of the fragment, and nothing that cannot be one', () => {
    expect(tokenOf(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenOf(`token=${TOKEN}&x=1`)).toBe(TOKEN);
    expect([tokenOf(''), tokenOf('#token=short'), tokenOf(`#token=${'a'.repeat(30)}%3C`)]).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe('isStrongPassword (ADR-003, as the API)', () => {
  it('wants 12 to 128 characters with a letter and a digit', () => {
    expect(isStrongPassword('correct horse 42')).toBe(true);
    expect(
      ['short1a', 'onlyletterslong', '123456789012', `a1${'x'.repeat(127)}`].map(isStrongPassword),
    ).toEqual([false, false, false, false]);
  });
});

describe('needsTwoFactor', () => {
  it('is the Owner and the Admin', () => {
    expect(['owner', 'admin', 'manager', 'sales'].map(needsTwoFactor)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('readLookup', () => {
  it('gives the invited email and role', async () => {
    expect(
      await readLookup(json(200, { invitedEmail: 'lan@example.test', role: 'sales' })),
    ).toEqual({
      kind: 'ok',
      invitedEmail: 'lan@example.test',
      role: 'sales',
    });
  });

  it('turns every refusal into one answer, and says what else went wrong without the words of the server', async () => {
    expect(await readLookup(json(404, { code: 'INVITE_INVALID' }))).toEqual({ kind: 'invalid' });
    expect(await readLookup(json(429, {}))).toEqual({ kind: 'error', message: TOO_MANY });
    expect(await readLookup(json(403, { code: 'FORBIDDEN_ORIGIN' }))).toEqual({
      kind: 'error',
      message: UNAVAILABLE,
    });
    expect(await readLookup(json(200, { role: 'sales' }))).toEqual({
      kind: 'error',
      message: UNAVAILABLE,
    });
  });
});

describe('readAccept', () => {
  it('joins, or names a weak password, or refuses the link', async () => {
    expect(await readAccept(json(200, { orgId: 'o', role: 'sales' }))).toEqual({ kind: 'ok' });
    expect(await readAccept(json(400, { code: 'PASSWORD_TOO_WEAK' }))).toEqual({ kind: 'weak' });
    expect(await readAccept(json(404, { code: 'INVITE_INVALID' }))).toEqual({ kind: 'invalid' });
    expect(await readAccept(new Response('Bad Gateway', { status: 502 }))).toEqual({
      kind: 'error',
      message: UNAVAILABLE,
    });
  });
});
