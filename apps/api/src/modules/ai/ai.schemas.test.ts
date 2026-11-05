import { describe, expect, it } from 'vitest';

import { AiSettingsSchema } from './ai.schemas.js';

// U74 (CEO 05/11/2026): the lock of `production` in the planned AiSettings, added as optional fields.
const settings = {
  environment: 'staging',
  features: { e1: false, l1: false },
  monthlyBudgetUsd: 0,
  usedThisMonthUsd: 0,
  resetsAt: '2026-11-30T17:00:00Z',
};

describe('AiSettings', () => {
  it('says when production is locked and why, and still reads a body without the two fields', () => {
    expect(AiSettingsSchema.safeParse(settings).success).toBe(true);
    expect(
      AiSettingsSchema.safeParse({
        ...settings,
        productionLocked: true,
        productionLockReason: 'legal_q1',
      }).success,
    ).toBe(true);
    expect(
      AiSettingsSchema.safeParse({
        ...settings,
        productionLocked: false,
        productionLockReason: null,
      }).success,
    ).toBe(true);
    expect(AiSettingsSchema.safeParse({ ...settings, productionLockReason: 'audit' }).success).toBe(
      false,
    );
  });
});
