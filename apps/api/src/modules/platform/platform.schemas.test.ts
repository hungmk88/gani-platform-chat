import { describe, expect, it } from 'vitest';

import {
  AccessSessionCreateSchema,
  AccessSessionListQuerySchema,
  AccessSessionRecordSchema,
  ChannelPolicyChangeSchema,
  TenantHealthSchema,
} from './platform.schemas.js';

// The rules the planned contract of #30 already states (U65, CEO 05/11/2026), checked before the module is built.
const ORG = '01900000-0000-7000-8000-000000000001';

describe('the platform contract', () => {
  it('needs a reason of 10 to 500 characters, trimmed and counted in NFC, and nothing else', () => {
    const ok = (reason: string, extra = {}) =>
      AccessSessionCreateSchema.safeParse({ orgId: ORG, reason, ...extra }).success;
    expect(
      AccessSessionCreateSchema.parse({ orgId: ORG, reason: '  Hỗ trợ sự cố 42  ' }).reason,
    ).toBe('Hỗ trợ sự cố 42');
    expect([ok('x'.repeat(10)), ok('x'.repeat(500))]).toEqual([true, true]);
    expect([ok('x'.repeat(9)), ok('x'.repeat(501)), ok('   '.repeat(5))]).toEqual([
      false,
      false,
      false,
    ]);
    // 250 letters that NFC turns into 500 characters (U+0958 → U+0915 U+093C): counted after NFC, as the reason is stored.
    expect(ok('क़'.repeat(250))).toBe(true);
    expect(ok('क़'.repeat(251))).toBe(false);
    expect(
      AccessSessionCreateSchema.parse({ orgId: ORG, reason: 'Kiểm tra lỗi'.normalize('NFD') })
        .reason,
    ).toBe('Kiểm tra lỗi'.normalize('NFC'));
    expect(ok('Hỗ trợ sự cố 42', { minutes: 120 })).toBe(false);
  });

  it('versions a channel policy from a required effectiveFrom, with a note', () => {
    const change = {
      effectiveFrom: '2027-01-01T00:00:00Z',
      freeWindowSeconds: 604800,
      freeMessageQuota: 8,
      unitPriceVnd: null,
      outsideWindowAllowed: false,
      sourceUrl: null,
      sourceDate: '2026-12-01',
      note: 'Bảng giá ZNS 2027',
    };
    expect(ChannelPolicyChangeSchema.safeParse(change).success).toBe(true);
    for (const wrong of [
      { ...change, effectiveFrom: undefined },
      { ...change, note: '  ' },
      { ...change, freeMessageQuota: -1 },
      { ...change, channelType: 'zalo_oa' },
    ])
      expect(ChannelPolicyChangeSchema.safeParse(wrong).success, JSON.stringify(wrong)).toBe(false);
  });

  it('gives the AI spend as null until the AI Gateway', () => {
    const health = {
      orgId: ORG,
      slug: 'gani-foods',
      name: 'Gani Foods',
      channels: { total: 2, tokenExpiringSoon: 1, tokenExpired: 0 },
      aiCostMonthVnd: null,
    };
    expect(TenantHealthSchema.safeParse(health).success).toBe(true);
    expect(TenantHealthSchema.safeParse({ ...health, aiCostMonthVnd: 120000 }).success).toBe(false);
  });

  it('lists the operator’s sessions by organisation and running or not, and says how one ended (U79)', () => {
    expect(AccessSessionListQuerySchema.parse({ orgId: ORG, active: 'false' })).toMatchObject({
      active: 'false',
      limit: 50,
    });
    expect(AccessSessionListQuerySchema.safeParse({ operatorUserId: ORG }).success).toBe(false);
    expect(AccessSessionListQuerySchema.safeParse({ active: 'yes' }).success).toBe(false);
    const running = {
      id: ORG,
      orgId: ORG,
      orgName: 'Gani Foods',
      operatorUserId: ORG,
      reason: 'Hỗ trợ sự cố 42',
      startedAt: '2026-11-05T08:00:00Z',
      expiresAt: '2026-11-05T09:00:00Z',
      endedAt: null,
      endReason: null,
    };
    expect(AccessSessionRecordSchema.safeParse(running).success).toBe(true);
    for (const endReason of ['manual', 'expired'])
      expect(
        AccessSessionRecordSchema.safeParse({
          ...running,
          endedAt: '2026-11-05T08:30:00Z',
          endReason,
        }).success,
      ).toBe(true);
    expect(AccessSessionRecordSchema.safeParse({ ...running, endReason: 'revoked' }).success).toBe(
      false,
    );
  });
});
