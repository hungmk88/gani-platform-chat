import { describe, expect, it } from 'vitest';

import { BAD_EMAIL, readForgot, readReset, TOO_MANY, UNAVAILABLE } from './password-reset';

const answer = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('readForgot', () => {
  it('says the same for any address the API takes, and why one is not taken', async () => {
    expect(await readForgot(answer(202, { accepted: true }))).toEqual({ kind: 'sent' });
    expect(await readForgot(answer(400, { code: 'INVALID_EMAIL' }))).toEqual({
      kind: 'error',
      message: BAD_EMAIL,
    });
    expect(await readForgot(answer(429))).toEqual({ kind: 'error', message: TOO_MANY });
    expect(await readForgot(answer(403, { code: 'FORBIDDEN_ORIGIN' }))).toEqual({
      kind: 'error',
      message: UNAVAILABLE,
    });
  });
});

describe('readReset', () => {
  it('tells done, a refused link, a weak password and the rest apart', async () => {
    expect(await readReset(answer(200, { reset: true }))).toEqual({ kind: 'ok' });
    expect(await readReset(answer(404, { code: 'RESET_INVALID' }))).toEqual({ kind: 'invalid' });
    expect(await readReset(answer(400, { code: 'PASSWORD_TOO_WEAK' }))).toEqual({ kind: 'weak' });
    expect(await readReset(answer(429))).toEqual({ kind: 'error', message: TOO_MANY });
    expect(await readReset(answer(503))).toEqual({ kind: 'error', message: UNAVAILABLE });
  });
});
