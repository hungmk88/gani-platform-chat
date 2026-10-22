import { describe, expect, it, vi } from 'vitest';

import { EmailConfigError, emailPolicy, MAILPIT_URL } from './policy.js';

const prod = {
  APP_ENV: 'production',
  SMTP_URL: 'smtps://u:p4ss@smtp.example.test:465',
  EMAIL_FROM: 'Gani <no-reply@example.test>',
};
const refused = (env: Record<string, string | undefined>) => {
  try {
    emailPolicy(env);
    return 'accepted';
  } catch (error) {
    return error instanceof EmailConfigError ? error.message : error;
  }
};

describe('emailPolicy', () => {
  it('takes the server and the sender of production when the connection is encrypted', () => {
    expect(emailPolicy(prod)).toEqual({ url: prod.SMTP_URL, from: prod.EMAIL_FROM });
    const starttls = { ...prod, SMTP_URL: 'smtp://u:p4ss@smtp.example.test:587?requireTLS=true' };
    expect(emailPolicy(starttls).url).toBe(starttls.SMTP_URL);
  });

  it('keeps production from starting without a server, a sender or encryption, naming the variable and never its value', () => {
    expect(refused({ ...prod, SMTP_URL: undefined })).toMatch(/^SMTP_URL is not set/);
    expect(refused({ ...prod, EMAIL_FROM: ' ' })).toMatch(/^EMAIL_FROM is not set/);
    const clear = refused({ ...prod, SMTP_URL: 'smtp://u:p4ss@smtp.example.test:25' });
    expect(clear).toMatch(/must be encrypted/);
    expect(String(clear)).not.toContain('p4ss');
    expect(refused({ ...prod, SMTP_URL: 'http://u:p4ss@x' })).toMatch(/smtp:\/\/ or smtps:\/\//);
    expect(refused({ ...prod, SMTP_URL: 'not a url' })).toBe('SMTP_URL is not a URL');
  });

  it('sends to Mailpit with a warning elsewhere, and accepts a clear connection outside production', () => {
    const warn = vi.fn();
    expect(emailPolicy({ APP_ENV: 'development' }, warn)).toEqual({
      url: MAILPIT_URL,
      from: 'Gani <no-reply@localhost>',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(emailPolicy({ APP_ENV: 'staging', SMTP_URL: 'smtp://mailpit:1025' }).url).toBe(
      'smtp://mailpit:1025',
    );
  });
});
