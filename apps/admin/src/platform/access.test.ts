import { describe, expect, it } from 'vitest';

import {
  createBodyOf,
  endText,
  reasonProblem,
  running,
  sessionsPath,
  type AccessSession,
} from './access';

const NOW = Date.parse('2026-11-05T10:30:00Z');
const S: AccessSession = {
  id: 's1',
  orgId: 'o1',
  orgName: 'Gani Foods',
  operatorUserId: 'u1',
  reason: 'Hỗ trợ lỗi kênh Zalo #128',
  startedAt: '2026-11-05T10:00:00Z',
  expiresAt: '2026-11-05T11:00:00Z',
  endedAt: null,
  endReason: null,
};

describe('#30 Phiên truy cập (U79)', () => {
  it('reads the sessions of one company or all, the running ones by default', () => {
    expect(sessionsPath('', true, null)).toBe('/v1/platform/access-sessions?limit=50&active=true');
    expect(sessionsPath('o1', false, 'c2')).toBe(
      '/v1/platform/access-sessions?limit=50&orgId=o1&cursor=c2',
    );
  });

  it('says how a session stands: running, ended early, or past its hour', () => {
    expect(running(S, NOW)).toBe(true);
    expect(endText(S, NOW)).toBe('Còn hiệu lực tới 18:00 05/11/2026');
    const ended = { ...S, endedAt: '2026-11-05T10:20:00Z', endReason: 'manual' as const };
    expect(running(ended, NOW)).toBe(false);
    expect(endText(ended, NOW)).toBe('Đã kết thúc lúc 17:20 05/11/2026');
    expect(running(S, Date.parse('2026-11-05T11:00:01Z'))).toBe(false);
    expect(endText({ ...S, endReason: 'expired', endedAt: S.expiresAt }, NOW)).toBe(
      'Hết hạn lúc 18:00 05/11/2026',
    );
  });

  it('checks the reason as the API does: trimmed, NFC, 10 to 500 UTF-16 units', () => {
    expect(reasonProblem('  ngắn quá ')).toMatch(/^Ghi lý do cụ thể \(ít nhất 10 ký tự\)/);
    expect(reasonProblem('a'.repeat(10))).toBeNull();
    expect(reasonProblem(`  ${'a'.repeat(500)}  `)).toBeNull();
    expect(reasonProblem('a'.repeat(501))).toBe('Lý do tối đa 500 ký tự.');
    expect(reasonProblem('é'.normalize('NFD').repeat(10))).toBeNull(); // 20 units typed, 10 in NFC
    expect(reasonProblem('😀'.repeat(251))).toBe('Lý do tối đa 500 ký tự.'); // two units each, as zod counts
    expect(createBodyOf('o1', '  Hỗ trợ yêu cầu #128  ')).toEqual({
      orgId: 'o1',
      reason: 'Hỗ trợ yêu cầu #128',
    });
  });
});
