import { describe, expect, it } from 'vitest';

import {
  budgetOf,
  budgetStop,
  budgetValue,
  featureBody,
  mayTurn,
  resetText,
  settingsPath,
  usdText,
} from './settings';

describe('AI nội bộ: môi trường, tính năng, ngân sách (#26 A)', () => {
  it('asks the settings of one workspace', () => {
    expect(settingsPath('ws-1')).toBe('/v1/workspaces/ws-1/ai-settings');
  });

  it('says what was spent, warned from 80 % and stopped from 100 % as BudgetGuard', () => {
    const at = (used: number) => budgetOf({ monthlyBudgetUsd: 200, usedThisMonthUsd: used });
    expect(at(10)).toEqual({
      used: `${usdText(10)} / ${usdText(200)} (5 %)`,
      tone: null,
      note: null,
    });
    expect(at(159.9).tone).toBeNull(); // 79,95 % is not 80 %
    expect(at(160)).toMatchObject({ tone: 'warn', note: 'Đã dùng từ 80 % ngân sách tháng.' });
    expect(at(199.99).tone).toBe('warn');
    expect(at(200)).toMatchObject({
      tone: 'error',
      note: 'Hết ngân sách tháng: AI nội bộ dừng, quay về kịch bản.',
    });
    // A budget of 0: no share; off, as the contract reads (CEO 01/11, U74).
    expect(budgetOf({ monthlyBudgetUsd: 0, usedThisMonthUsd: 0 })).toEqual({
      used: `${usdText(0)} / ${usdText(0)}`,
      tone: 'error',
      note: '0 USD = AI nội bộ tắt hoàn toàn.',
    });
  });

  it('says when the month starts again in the zone of the workspace, or in Viet Nam time said so', () => {
    const resetsAt = '2026-11-30T17:00:00.000Z';
    expect(resetText(resetsAt, 'Asia/Ho_Chi_Minh')).toBe(
      '00:00 01/12/2026 (múi giờ của workspace: Asia/Ho_Chi_Minh)',
    );
    expect(resetText(resetsAt, 'Asia/Tokyo')).toBe(
      '02:00 01/12/2026 (múi giờ của workspace: Asia/Tokyo)',
    );
    expect(resetText(resetsAt, null)).toBe('00:00 01/12/2026 (giờ Việt Nam)');
    // Empty, blank or unknown: Intl would throw a RangeError and break the screen; Viet Nam's time, said so.
    for (const zone of ['', '   ', 'Not/AZone'])
      expect(resetText(resetsAt, zone)).toBe('00:00 01/12/2026 (giờ Việt Nam)');
  });

  it('turns a feature on only in staging, off anywhere, sending that feature only (B1, CEO 01/11)', () => {
    expect(mayTurn('staging', true)).toBe(true);
    expect(mayTurn('production', true)).toBe(false);
    expect(mayTurn('staging', false)).toBe(true);
    expect(mayTurn('production', false)).toBe(true);
    expect(featureBody('l1', true)).toEqual({ features: { l1: true } });
  });

  it('takes a budget as the API does and says what saving it does at once (B1b, CEO 01/11)', () => {
    for (const raw of ['', '  ', '-1', '1000000.01', 'abc'])
      expect(budgetValue(raw)).toBe('Nhập số tiền từ 0 đến 1.000.000 USD.');
    expect([budgetValue('0'), budgetValue(' 150.5 '), budgetValue('1000000')]).toEqual([
      0, 150.5, 1_000_000,
    ]);
    expect(budgetStop(0, 0, 'x')).toBe('0 USD = AI nội bộ tắt hoàn toàn.');
    expect(budgetStop(170, 170, '00:00 01/12/2026')).toBe(
      `Ngân sách mới (${usdText(170)}) không lớn hơn số đã dùng tháng này (${usdText(170)}): AI nội bộ sẽ dừng ngay tới 00:00 01/12/2026.`,
    );
    expect(budgetStop(170.01, 170, 'x')).toBeNull();
  });
});
