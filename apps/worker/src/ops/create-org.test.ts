import { describe, expect, it } from 'vitest';

import { CreateOrgRefusedError, ownerInvitation, readCreateOrgArgs } from './create-org.js';

const argv = [
  '--name',
  ' Gani Foods ',
  '--slug',
  'gani-foods',
  '--owner-email',
  ' Lan@Example.TEST ',
  '--operator',
  'ops@example.test',
];
const env = { APP_ENV: 'production', ADMIN_URL: 'https://admin.example.test/anything' };
const reason = (a: string[], e: Record<string, string | undefined> = env) => {
  try {
    readCreateOrgArgs(a, e);
    return 'accepted';
  } catch (error) {
    return error instanceof CreateOrgRefusedError ? error.reason : error;
  }
};
const without = (name: string) => {
  const at = argv.indexOf(name);
  return [...argv.slice(0, at), ...argv.slice(at + 2)];
};

describe('readCreateOrgArgs', () => {
  it('reads the flags, normalises the emails and keeps only the origin of the admin', () => {
    expect(readCreateOrgArgs(argv, env)).toEqual({
      name: 'Gani Foods',
      slug: 'gani-foods',
      ownerEmail: 'lan@example.test',
      operatorEmail: 'ops@example.test',
      adminUrl: 'https://admin.example.test',
    });
  });

  it('refuses what it cannot use, before touching anything', () => {
    expect(reason(argv, { ...env, APP_ENV: undefined })).toBe('app_env_missing');
    expect(reason(without('--name'))).toBe('name_invalid');
    for (const slug of ['Gani', 'a', '-x', 'x--y', 'x_y', 'a'.repeat(64)])
      expect(reason(argv.map((v) => (v === 'gani-foods' ? slug : v))), slug).toBe('slug_invalid');
    expect(reason(without('--owner-email'))).toBe('email_invalid');
    expect(reason(without('--operator'))).toBe('email_invalid');
    expect(reason(argv, { ...env, ADMIN_URL: 'not a url' })).toBe('admin_url_invalid');
    expect(reason(argv, { ...env, ADMIN_URL: 'http://admin.example.test' })).toBe(
      'admin_url_invalid',
    );
    expect(reason(argv, { ...env, ADMIN_URL: 'http://localhost:3000' })).toBe('admin_url_invalid');
    expect(reason(argv, { APP_ENV: 'development', ADMIN_URL: 'http://localhost:3000' })).toBe(
      'accepted',
    );
  });
});

describe('ownerInvitation', () => {
  it('puts the token in the fragment of the link, says when it expires, and goes to the owner', () => {
    const message = ownerInvitation(readCreateOrgArgs(argv, env), 'tok-123');
    expect(message.to).toBe('lan@example.test');
    expect(message.subject).toContain('Gani Foods');
    expect(message.text).toContain('https://admin.example.test/invite#token=tok-123');
    expect(message.text).toContain('7 ngày');
  });
});
