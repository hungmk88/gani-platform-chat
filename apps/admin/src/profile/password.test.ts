import { describe, expect, it } from 'vitest';

import { passwordProblem, readChangePassword } from './password';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('passwordProblem', () => {
  it('asks for the current password first', () => {
    expect(passwordProblem('', 'matkhau-moi-123', 'matkhau-moi-123')).toBe(
      'Nhập mật khẩu hiện tại.',
    );
  });

  it('holds the new one to ADR-003: 12 to 128 characters, a letter and a digit', () => {
    expect(passwordProblem('cu-123456789', 'ngan123', 'ngan123')).toMatch(/từ 12 đến 128/);
    expect(passwordProblem('cu-123456789', 'a1'.repeat(65), 'a1'.repeat(65))).toMatch(
      /từ 12 đến 128/,
    );
    expect(passwordProblem('cu-123456789', 'aaaaaaaaaaaa', 'aaaaaaaaaaaa')).toBe(
      'Mật khẩu mới cần có cả chữ và số.',
    );
    expect(passwordProblem('cu-123456789', '123456789012', '123456789012')).toBe(
      'Mật khẩu mới cần có cả chữ và số.',
    );
  });

  it('refuses the same password and a mismatched repeat, then accepts', () => {
    expect(passwordProblem('matkhau-cu-123', 'matkhau-cu-123', 'matkhau-cu-123')).toMatch(
      /phải khác/,
    );
    expect(passwordProblem('matkhau-cu-123', 'matkhau-moi-123', 'matkhau-moi-124')).toMatch(
      /chưa khớp/,
    );
    expect(passwordProblem('matkhau-cu-123', 'matkhau-moi-123', 'matkhau-moi-123')).toBeNull();
  });
});

describe('readChangePassword', () => {
  it('reads success, a lost session and the rate limit', async () => {
    expect(await readChangePassword(json(200, { token: null }))).toEqual({ kind: 'ok' });
    expect(await readChangePassword(json(401, {}))).toEqual({ kind: 'signed_out' });
    expect(await readChangePassword(json(429, {}))).toMatchObject({
      kind: 'error',
      message: expect.stringMatching(/quá nhiều/) as unknown,
    });
  });

  it('says which rule Better Auth refused, and one sentence for anything else', async () => {
    expect(await readChangePassword(json(400, { code: 'INVALID_PASSWORD' }))).toEqual({
      kind: 'error',
      message: 'Mật khẩu hiện tại chưa đúng.',
    });
    expect(await readChangePassword(json(400, { code: 'PASSWORD_TOO_SHORT' }))).toMatchObject({
      message: expect.stringMatching(/từ 12 đến 128/) as unknown,
    });
    expect(await readChangePassword(new Response('oops', { status: 500 }))).toMatchObject({
      message: expect.stringMatching(/Không đổi được/) as unknown,
    });
  });
});
