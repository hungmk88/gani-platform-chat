import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { loadAuthEnv, MIN_SECRET_LENGTH } from './auth.env.js';

const token = (length: number) => randomBytes(length).toString('hex').slice(0, length);
const good = {
  BETTER_AUTH_SECRET: token(MIN_SECRET_LENGTH),
  BETTER_AUTH_URL: 'https://app.example.test',
};

describe('loadAuthEnv', () => {
  it('returns the secret, the origin and secure cookies for an https address', () => {
    expect(loadAuthEnv(good)).toEqual({
      secret: good.BETTER_AUTH_SECRET,
      baseURL: 'https://app.example.test',
      secureCookies: true,
    });
  });

  it('refuses a secret shorter than 32 characters, without repeating it, and takes exactly 32', () => {
    const short = token(MIN_SECRET_LENGTH - 1);
    const call = () => loadAuthEnv({ ...good, BETTER_AUTH_SECRET: short });
    expect(call).toThrow(/at least 32/);
    expect(call).not.toThrow(new RegExp(short));
    expect(() => loadAuthEnv({ ...good, BETTER_AUTH_SECRET: undefined })).toThrow(/at least 32/);
  });

  it.each([
    undefined,
    '',
    'not a url',
    'ftp://app.example.test',
    'https://app.example.test/api',
    'https://app.example.test/?x=1',
  ])('refuses the address %j', (url) => {
    expect(() => loadAuthEnv({ ...good, BETTER_AUTH_URL: url })).toThrow(/BETTER_AUTH_URL/);
  });

  it('refuses an address with a password and does not echo it', () => {
    const call = () =>
      loadAuthEnv({ ...good, BETTER_AUTH_URL: 'https://admin:hunter2@app.example.test' });
    expect(call).toThrow(/user name or password/);
    expect(call).not.toThrow(/hunter2/);
  });

  it('refuses BETTER_AUTH_TELEMETRY when it is on, because it beats the setting in code', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(() => loadAuthEnv({ ...good, BETTER_AUTH_TELEMETRY: value }), value).toThrow(
        /telemetry/i,
      );
    }
    for (const value of [undefined, '', '0', 'false'])
      expect(
        () => loadAuthEnv({ ...good, BETTER_AUTH_TELEMETRY: value }),
        String(value),
      ).not.toThrow();
  });
});

describe('http', () => {
  const http = { ...good, BETTER_AUTH_URL: 'http://localhost:3000' };

  it.each(['development', 'test'])(
    'is accepted only with APP_ENV=%s and AUTH_ALLOW_HTTP=true, and then cookies are not secure',
    (APP_ENV) => {
      expect(loadAuthEnv({ ...http, APP_ENV, AUTH_ALLOW_HTTP: 'true' })).toMatchObject({
        baseURL: 'http://localhost:3000',
        secureCookies: false,
      });
      expect(() => loadAuthEnv({ ...http, APP_ENV })).toThrow(/must be https/);
      expect(() => loadAuthEnv({ ...http, APP_ENV, AUTH_ALLOW_HTTP: 'yes' })).toThrow(
        /must be https/,
      );
    },
  );

  it.each(['production', 'staging', undefined])(
    'is refused with APP_ENV=%s even when AUTH_ALLOW_HTTP=true',
    (APP_ENV) => {
      expect(() => loadAuthEnv({ ...http, APP_ENV, AUTH_ALLOW_HTTP: 'true' })).toThrow(
        /must be https/,
      );
    },
  );

  it('does not need the flag for https, whatever APP_ENV is', () => {
    expect(loadAuthEnv({ ...good, APP_ENV: 'production' }).secureCookies).toBe(true);
  });
});
