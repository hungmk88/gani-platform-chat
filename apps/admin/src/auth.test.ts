import { describe, expect, it } from 'vitest';

import {
  readSecurityStatus,
  readSignIn,
  TOO_MANY_REQUESTS,
  UNAVAILABLE,
  WRONG_CREDENTIALS,
} from './auth';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('readSignIn', () => {
  it('signs in, or asks for the second factor', async () => {
    expect(await readSignIn(json(200, { redirect: false }))).toEqual({ kind: 'ok' });
    expect(await readSignIn(json(200, { twoFactorRedirect: true }))).toEqual({
      kind: 'two_factor',
    });
  });

  it('gives one sentence for a wrong password and for a locked account (same 401)', async () => {
    expect(await readSignIn(json(401, { code: 'INVALID_EMAIL_OR_PASSWORD' }))).toEqual({
      kind: 'error',
      message: WRONG_CREDENTIALS,
    });
  });

  it('asks to wait after 10 tries in a minute (429)', async () => {
    expect(await readSignIn(json(429, { message: 'Too many requests' }))).toEqual({
      kind: 'error',
      message: TOO_MANY_REQUESTS,
    });
  });

  it('says the service is down for anything else, without its words', async () => {
    expect(await readSignIn(new Response('Bad Gateway', { status: 502 }))).toEqual({
      kind: 'error',
      message: UNAVAILABLE,
    });
  });
});

describe('readSecurityStatus', () => {
  it('lets in, or sends to the set-up of 2FA (N93)', async () => {
    expect(
      await readSecurityStatus(
        json(200, { twoFactorEnabled: true, required: true, mustSetUp: false }),
      ),
    ).toEqual({ kind: 'signed_in', twoFactorEnabled: true });
    expect(
      await readSecurityStatus(
        json(200, { twoFactorEnabled: false, required: true, mustSetUp: true }),
      ),
    ).toEqual({ kind: 'must_set_up' });
  });

  it('sends a person without a session to sign in', async () => {
    expect(await readSecurityStatus(json(401, { code: 'unauthorized' }))).toEqual({
      kind: 'signed_out',
    });
  });

  it('keeps the traceId of an error, and refuses a 200 of another shape', async () => {
    expect(
      await readSecurityStatus(json(503, { code: 'service_unavailable', traceId: 't' })),
    ).toEqual({ kind: 'error', status: 503, traceId: 't' });
    expect(await readSecurityStatus(json(200, {}))).toEqual({
      kind: 'error',
      status: 502,
      traceId: null,
    });
  });
});
