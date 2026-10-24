import { describe, expect, it } from 'vitest';

import { errorOf } from '../api/errors';
import {
  canChangeRole,
  canResend,
  membersPath,
  roleError,
  twoFactorOf,
  withMember,
  withRenewed,
  type Member,
} from './list';

const member = (over: Partial<Member>): Member => ({
  id: 'm1',
  userId: 'u1',
  name: 'Trần Thu',
  email: 'tranthu@example.test',
  role: 'sales',
  status: 'active',
  twoFactorEnabled: false,
  expiresAt: null,
  ...over,
});

describe('membersPath', () => {
  it('asks a page of 50, then the next by its cursor', () => {
    expect(membersPath(null)).toBe('/v1/members?limit=50');
    expect(membersPath('a/b')).toBe('/v1/members?limit=50&cursor=a%2Fb');
  });
});

describe('twoFactorOf', () => {
  it('says nothing for an invitation and "required" for an Owner or an Admin without it', () => {
    expect(twoFactorOf(member({ status: 'pending' }))).toEqual({ text: '—', tone: null });
    expect(twoFactorOf(member({ status: 'expired' }))).toEqual({ text: '—', tone: null });
    expect(twoFactorOf(member({ twoFactorEnabled: true }))).toEqual({ text: 'Đã bật', tone: 'ok' });
    expect(twoFactorOf(member({ role: 'admin' }))).toEqual({
      text: 'Bắt buộc, chưa cài',
      tone: 'error',
    });
    expect(twoFactorOf(member({}))).toEqual({ text: 'Chưa bật', tone: null });
  });
});

describe('canResend', () => {
  it('lets whoever may invite the role send a pending or expired invitation again', () => {
    expect(canResend('admin', member({ status: 'pending' }))).toBe(true);
    expect(canResend('admin', member({ status: 'expired' }))).toBe(true);
    expect(canResend('admin', member({ status: 'pending', role: 'owner' }))).toBe(false);
    expect(canResend('owner', member({ status: 'pending', role: 'owner' }))).toBe(true);
    expect(canResend('owner', member({ status: 'active' }))).toBe(false);
    expect(canResend('manager', member({ status: 'pending' }))).toBe(false);
  });
});

describe('withRenewed', () => {
  it('makes the renewed row pending with its new expiry and leaves the others', () => {
    const pages = {
      pageParams: [null],
      pages: [
        {
          data: [member({}), member({ id: 'm2', status: 'expired', expiresAt: 'old' })],
          nextCursor: null,
        },
      ],
    };
    const next = withRenewed(pages, { id: 'm2', expiresAt: 'new' });
    expect(next?.pages[0]?.data[1]).toMatchObject({ status: 'pending', expiresAt: 'new' });
    expect(next?.pages[0]?.data[0]).toBe(pages.pages[0]?.data[0]);
    expect(withRenewed(undefined, { id: 'm2', expiresAt: 'new' })).toBeUndefined();
  });
});

describe('canChangeRole', () => {
  it('lets an Owner change anyone but themselves, an Admin anyone but an Owner, never an invitation', () => {
    expect(canChangeRole('owner', 'u9', member({ role: 'admin' }))).toBe(true);
    expect(canChangeRole('owner', 'u9', member({ role: 'owner', status: 'suspended' }))).toBe(true);
    expect(canChangeRole('owner', 'u1', member({}))).toBe(false);
    expect(canChangeRole('admin', 'u9', member({}))).toBe(true);
    expect(canChangeRole('admin', 'u9', member({ role: 'owner' }))).toBe(false);
    expect(canChangeRole('owner', 'u9', member({ status: 'pending', userId: null }))).toBe(false);
    expect(canChangeRole('manager', 'u9', member({}))).toBe(false);
  });
});

describe('withMember and roleError', () => {
  it('puts the answer of the API in place of its row', () => {
    const pages = { pageParams: [null], pages: [{ data: [member({})], nextCursor: null }] };
    expect(withMember(pages, member({ role: 'manager' }))?.pages[0]?.data[0]?.role).toBe('manager');
    expect(withMember(undefined, member({}))).toBeUndefined();
  });

  it('says the last Owner, a refusal and a member gone in words of the screen', () => {
    expect(roleError(errorOf(409, { code: 'last_owner' }))).toMatch(/ít nhất một Owner/);
    expect(roleError(errorOf(403, { code: 'forbidden' }))).toBe('Bạn không đổi được vai trò này.');
    expect(roleError(errorOf(404, { code: 'not_found' }))).toMatch(/Không tìm thấy/);
    expect(roleError(errorOf(503, {}))).toBe(errorOf(503, {}).message);
  });
});
