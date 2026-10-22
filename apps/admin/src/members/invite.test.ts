import { describe, expect, it } from 'vitest';

import { errorOf } from '../api/errors';
import { emailOf, invitableRoles, invitedText, inviteError, MAX_EMAIL } from './invite';

describe('invitableRoles', () => {
  it('lets an Owner invite any role, an Admin any but Owner, and nobody else', () => {
    expect(invitableRoles('owner')).toEqual([
      'owner',
      'admin',
      'manager',
      'sales',
      'support',
      'marketing',
      'viewer',
    ]);
    expect(invitableRoles('admin')).not.toContain('owner');
    expect(invitableRoles('admin')).toHaveLength(6);
    for (const r of [
      'manager',
      'sales',
      'support',
      'marketing',
      'viewer',
      'platform_operator',
    ] as const)
      expect(invitableRoles(r)).toEqual([]);
  });
});

describe('emailOf', () => {
  it('keeps the email as the API stores it', () => {
    expect(emailOf('  Nguoi.Moi@Example.TEST ')).toEqual({
      ok: true,
      email: 'nguoi.moi@example.test',
    });
  });

  it('refuses an empty, a malformed and a too long email', () => {
    expect(emailOf('  ')).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/Nhập email/) as unknown,
    });
    expect(emailOf('khong-co-a-cong')).toMatchObject({ ok: false });
    expect(emailOf('a b@x.vn')).toMatchObject({ ok: false });
    expect(emailOf(`${'a'.repeat(MAX_EMAIL)}@x.vn`)).toMatchObject({ ok: false });
  });
});

describe('invitedText', () => {
  it('gives the expiry of the API in Vietnam time, and says when the email did not go', () => {
    const i = { email: 'moi@example.test', expiresAt: '2026-10-29T03:00:00Z', emailSent: true };
    expect(invitedText(i)).toBe(
      'Đã gửi lời mời tới moi@example.test. Link dùng được đến 10:00 29/10/2026.',
    );
    expect(invitedText({ ...i, emailSent: false })).toMatch(/chưa gửi được email/);
  });
});

describe('inviteError', () => {
  it('says a pending invitation, a role out of reach and a bad field in words of this screen', () => {
    expect(inviteError(errorOf(409, { code: 'duplicate_resource' }))).toBe(
      'Email này đang có lời mời chờ nhận.',
    );
    expect(inviteError(errorOf(403, { code: 'forbidden' }))).toBe(
      'Bạn không mời được vai trò này.',
    );
    expect(inviteError(errorOf(400, { code: 'validation_failed' }))).toMatch(/chưa hợp lệ/);
    expect(inviteError(errorOf(503, {}))).toBe(errorOf(503, {}).message);
  });
});
