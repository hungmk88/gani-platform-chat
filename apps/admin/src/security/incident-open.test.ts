import { describe, expect, it } from 'vitest';

import type { Member } from '../members/list';
import { handlersOf, incidentBodyOf, SEVERITIES, titleProblem } from './incident-open';

const member = (userId: string | null, name: string | null, role: string, status: string) =>
  ({ id: `m-${userId}`, userId, name, email: `${userId}@example.test`, role, status }) as Member;

describe('Mở sự cố (#29 B1)', () => {
  it('offers the four severities of the contract, lowest first (brief 61)', () => {
    expect(SEVERITIES).toEqual(['low', 'medium', 'high', 'critical']);
  });

  it('asks a title of 1–200 characters without a phone or an e-mail', () => {
    expect(titleProblem('  ')).toBe('Ghi tên sự cố.');
    expect(titleProblem('a'.repeat(201))).toBe('Tên sự cố tối đa 200 ký tự.');
    expect(titleProblem('Khách 0912345678 gọi báo')).toMatch(/^Bỏ SĐT, email/);
    expect(titleProblem('Gửi về an@example.test')).toMatch(/^Bỏ SĐT, email/);
    expect(titleProblem(` ${'a'.repeat(200)} `)).toBeNull();
  });

  it('lets only an active Owner or Admin handle it, by name', () => {
    const handlers = handlersOf([
      member('u-b', 'Bình', 'admin', 'active'),
      member('u-a', 'An', 'owner', 'active'),
      member('u-c', 'Chi', 'manager', 'active'),
      member('u-d', 'Dũng', 'admin', 'suspended'),
      member(null, null, 'owner', 'pending'),
    ]);
    expect(handlers).toEqual([
      { userId: 'u-a', label: 'An · Owner' },
      { userId: 'u-b', label: 'Bình · Admin' },
    ]);
  });

  it('sends the title trimmed, the severity and the handler, nothing else', () => {
    expect(incidentBodyOf('  Lộ mật khẩu  ', 'high', 'u-a')).toEqual({
      title: 'Lộ mật khẩu',
      severity: 'high',
      handlerUserId: 'u-a',
    });
  });
});
