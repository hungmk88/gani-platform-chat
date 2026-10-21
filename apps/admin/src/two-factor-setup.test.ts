import { describe, expect, it } from 'vitest';

import {
  backupCodesFile,
  manualKey,
  readEnable,
  UNAVAILABLE,
  WRONG_PASSWORD,
} from './two-factor-setup';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const uri = 'otpauth://totp/Gani:linh%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Gani';

describe('readEnable', () => {
  it('returns the URI and the codes', async () => {
    expect(await readEnable(json(200, { totpURI: uri, backupCodes: ['a1', 'b2'] }))).toEqual({
      kind: 'ok',
      totpURI: uri,
      backupCodes: ['a1', 'b2'],
    });
  });

  it('says a wrong password, and that 2FA is already on', async () => {
    expect(await readEnable(json(400, { code: 'INVALID_PASSWORD' }))).toEqual({
      kind: 'error',
      message: WRONG_PASSWORD,
    });
    expect(await readEnable(json(400, { code: 'TOTP_ALREADY_ENABLED' }))).toEqual({
      kind: 'already_on',
    });
  });

  it('treats a 200 of another shape, or any other error, as the service being down', async () => {
    expect(await readEnable(json(200, { totpURI: uri }))).toEqual({
      kind: 'error',
      message: UNAVAILABLE,
    });
    expect(await readEnable(json(500, null))).toEqual({ kind: 'error', message: UNAVAILABLE });
  });
});

describe('manualKey and backupCodesFile', () => {
  it('shows the secret of the URI in groups of 4', () => {
    expect(manualKey(uri)).toBe('JBSW Y3DP EHPK 3PXP');
    expect(manualKey('not a uri')).toBe('');
  });

  it('writes one code per line', () => {
    expect(backupCodesFile(['a1', 'b2']).split('\n').slice(3, 5)).toEqual(['a1', 'b2']);
  });
});
