import { describe, expect, it } from 'vitest';

import { checkPiiLeaks, findPiiLeaks, type PiiLeakType } from './pii-leak.js';
import { createPiiVault, maskPii } from './pii-masker.js';

const RAW =
  'Gọi 0912345678 hoặc +84 987 654 321, mail an@gani.vn, CCCD 001099012345, CMND 123456789';

function hooks() {
  const warnings: { message: string; fields: Record<string, string | number> }[] = [];
  const counted: PiiLeakType[] = [];
  return {
    warnings,
    counted,
    log: {
      warn: (message: string, fields: Record<string, string | number>) =>
        warnings.push({ message, fields }),
    },
    onLeakDetected: (type: PiiLeakType) => counted.push(type),
    ids: { traceId: 't-1', orgId: 'o-1' },
  };
}

describe('findPiiLeaks', () => {
  it('finds phones, emails and id numbers left in the text', () => {
    expect(findPiiLeaks(RAW)).toEqual(['EMAIL', 'PHONE', 'ID_NUMBER']);
    expect(findPiiLeaks('liên hệ 028 3812 3456')).toEqual(['PHONE']);
    expect(findPiiLeaks('cmnd 123456789')).toEqual(['ID_NUMBER']);
  });

  it('finds nothing in placeholders, in what maskPii returns, or in prices and short codes', () => {
    expect(findPiiLeaks('[PHONE_1] [EMAIL_12] [ID_NUMBER_3]')).toEqual([]);
    expect(findPiiLeaks(maskPii(RAW, createPiiVault()))).toEqual([]);
    expect(findPiiLeaks('Giá 1.250.000 đ, mã SP123, 50 thùng, đơn DH12345678')).toEqual([]);
  });
});

describe('checkPiiLeaks', () => {
  it('warns PII_LEAK_DETECTED with the types and the ids only, and counts each type', () => {
    const h = hooks();
    expect(checkPiiLeaks(RAW, h)).toEqual(['EMAIL', 'PHONE', 'ID_NUMBER']);
    expect(h.warnings).toEqual([
      {
        message: 'pii_leak_detected',
        fields: {
          traceId: 't-1',
          orgId: 'o-1',
          code: 'PII_LEAK_DETECTED',
          types: 'EMAIL,PHONE,ID_NUMBER',
          count: 3,
        },
      },
    ]);
    expect(h.counted).toEqual(['EMAIL', 'PHONE', 'ID_NUMBER']);
    // No value reaches the log.
    const logged = JSON.stringify(h.warnings);
    for (const value of ['0912345678', '987', 'an@gani.vn', '001099012345', '123456789'])
      expect(logged).not.toContain(value);
  });

  it('stays silent on clean text, and works without a counter', () => {
    const h = hooks();
    expect(checkPiiLeaks('Dạ [NAME_1], em gửi báo giá {{price_1}} ạ', h)).toEqual([]);
    expect(h.warnings).toEqual([]);
    expect(h.counted).toEqual([]);
    expect(checkPiiLeaks('mail a@b.vn', { log: h.log })).toEqual(['EMAIL']);
    expect(h.warnings[0]?.fields).toEqual({ code: 'PII_LEAK_DETECTED', types: 'EMAIL', count: 1 });
  });
});
