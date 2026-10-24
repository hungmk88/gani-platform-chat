import { describe, expect, it } from 'vitest';

import { CreateWorkspaceRefusedError, readCreateWorkspaceArgs } from './create-workspace.js';

const argv = [
  '--org',
  'gani-foods',
  '--name',
  ' Bán sỉ ',
  '--slug',
  'b2b',
  '--template',
  'b2b',
  '--operator',
  ' Ops@Example.TEST ',
];
const env = { APP_ENV: 'production' };
const reason = (a: string[], e: Record<string, string | undefined> = env) => {
  try {
    readCreateWorkspaceArgs(a, e);
    return 'accepted';
  } catch (error) {
    return error instanceof CreateWorkspaceRefusedError ? error.reason : error;
  }
};
const replace = (name: string, value: string) => {
  const at = argv.indexOf(name);
  return [...argv.slice(0, at + 1), value, ...argv.slice(at + 2)];
};

describe('readCreateWorkspaceArgs (A2, N158)', () => {
  it('reads the flags, maps the template and defaults the time zone to Việt Nam', () => {
    expect(readCreateWorkspaceArgs(argv, env)).toEqual({
      org: 'gani-foods',
      name: 'Bán sỉ',
      slug: 'b2b',
      template: 'b2b_sales',
      timezone: 'Asia/Ho_Chi_Minh',
      operatorEmail: 'ops@example.test',
    });
    expect(
      readCreateWorkspaceArgs([...replace('--template', 'b2c'), '--timezone', 'Asia/Bangkok'], env),
    ).toMatchObject({ template: 'b2c_order', timezone: 'Asia/Bangkok' });
  });

  it('refuses what it cannot use, before touching anything', () => {
    expect([
      reason(argv, {}),
      reason(replace('--org', 'Gani Foods')),
      reason(replace('--name', '  ')),
      reason(replace('--slug', 'x')),
      reason(replace('--template', 'b2b_sales')),
      reason(replace('--template', 'toString')),
      reason([...argv, '--timezone', 'Mars/Base']),
      reason(replace('--operator', 'nobody')),
    ]).toEqual([
      'app_env_missing',
      'org_invalid',
      'name_invalid',
      'slug_invalid',
      'template_invalid',
      'template_invalid',
      'timezone_invalid',
      'email_invalid',
    ]);
  });
});
