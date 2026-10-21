import { describe, expect, it } from 'vitest';

import {
  EXPIRED,
  LOCKED,
  readVerify,
  TOO_MANY,
  UNAVAILABLE,
  WRONG_BACKUP_CODE,
  WRONG_CODE,
} from './two-factor';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('readVerify', () => {
  it('finishes the sign-in on 200', async () => {
    expect(await readVerify(json(200, { token: null }), 'totp')).toEqual({ kind: 'ok' });
  });

  it('names the kind of code that was wrong', async () => {
    expect(await readVerify(json(401, { code: 'INVALID_CODE' }), 'totp')).toEqual({
      kind: 'error',
      message: WRONG_CODE,
      restart: false,
    });
    expect(await readVerify(json(401, { code: 'INVALID_BACKUP_CODE' }), 'backup')).toEqual({
      kind: 'error',
      message: WRONG_BACKUP_CODE,
      restart: false,
    });
  });

  it('says the 30-minute lock after 5 wrong codes', async () => {
    expect(await readVerify(json(403, { code: 'ACCOUNT_TEMPORARILY_LOCKED' }), 'totp')).toEqual({
      kind: 'error',
      message: LOCKED,
      restart: false,
    });
  });

  it('sends back to /login when the pending sign-in is gone', async () => {
    expect(await readVerify(json(401, { code: 'INVALID_TWO_FACTOR_COOKIE' }), 'backup')).toEqual({
      kind: 'error',
      message: EXPIRED,
      restart: true,
    });
  });

  it('asks to wait on 429, and says the service is down for anything else', async () => {
    expect(await readVerify(json(429, {}), 'totp')).toEqual({
      kind: 'error',
      message: TOO_MANY,
      restart: false,
    });
    expect(await readVerify(new Response('oops', { status: 500 }), 'totp')).toEqual({
      kind: 'error',
      message: UNAVAILABLE,
      restart: false,
    });
  });
});
