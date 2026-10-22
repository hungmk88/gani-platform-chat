import { describe, expect, it } from 'vitest';

import { BootstrapRefusedError, readBootstrapEnv } from './bootstrap-operator.js';

const ok = {
  APP_ENV: 'production',
  BOOTSTRAP_OPERATOR_EMAIL: '  Ops@Example.TEST ',
  BOOTSTRAP_OPERATOR_PASSWORD: 'correct horse 42 battery',
};
const reason = (env: Record<string, string | undefined>) => {
  try {
    readBootstrapEnv(env);
    return 'accepted';
  } catch (error) {
    return error instanceof BootstrapRefusedError ? error.reason : error;
  }
};

describe('readBootstrapEnv', () => {
  it('reads the email normalised, the password and a default name', () => {
    expect(readBootstrapEnv(ok)).toEqual({
      email: 'ops@example.test',
      password: 'correct horse 42 battery',
      displayName: 'Platform operator',
    });
    expect(readBootstrapEnv({ ...ok, BOOTSTRAP_OPERATOR_NAME: ' Hưng ' }).displayName).toBe('Hưng');
  });

  it('refuses an environment that does not say what it is', () => {
    expect(reason({ ...ok, APP_ENV: undefined })).toBe('app_env_missing');
    expect(reason({ ...ok, APP_ENV: 'prod' })).toBe('app_env_missing');
  });

  it('refuses an email that is not one and a password ADR-003 does not allow', () => {
    expect(reason({ ...ok, BOOTSTRAP_OPERATOR_EMAIL: 'ops' })).toBe('email_invalid');
    expect(reason({ ...ok, BOOTSTRAP_OPERATOR_EMAIL: undefined })).toBe('email_invalid');
    expect(reason({ ...ok, BOOTSTRAP_OPERATOR_PASSWORD: 'short1' })).toBe('password_weak');
    expect(reason({ ...ok, BOOTSTRAP_OPERATOR_PASSWORD: 'no digits in this one' })).toBe(
      'password_weak',
    );
  });
});
