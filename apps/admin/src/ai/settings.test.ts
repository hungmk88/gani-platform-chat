import { describe, expect, it } from 'vitest';

import { budgetOf, resetText, settingsPath, usdText } from './settings';

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
    // A budget of 0: no share, no state (U74).
    expect(budgetOf({ monthlyBudgetUsd: 0, usedThisMonthUsd: 0 })).toEqual({
      used: `${usdText(0)} / ${usdText(0)}`,
      tone: null,
      note: null,
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
});
