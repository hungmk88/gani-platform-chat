import { DEFAULT_WORKING_WEEK } from '@gani/domain';
import type { TenantTx } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import { workspaceOpenAt, type BusinessHoursStore } from './business-hours.js';

// The business hours of a workspace at a moment (C10-4a), over a fake of the store; the SQL is tested in packages/db
// (business-hours-store.spec.ts) and the rule in packages/domain (business-hours.test.ts).
const tx = {} as TenantTx;
const TUESDAY_10H = new Date('2026-11-03T03:00:00Z'); // 10:00 in Ho Chi Minh City
const SATURDAY_10H = new Date('2026-11-07T03:00:00Z');
const AFTER_MIDNIGHT = new Date('2026-11-03T18:00:00Z'); // 01:00 on Wednesday 4 November there

function store(daysOff: { startsOn: string; endsOn: string }[] = [], hours: unknown = undefined) {
  return {
    readWorkingWeek: vi.fn(() =>
      Promise.resolve(
        hours === undefined
          ? { timezone: 'Asia/Ho_Chi_Minh', week: DEFAULT_WORKING_WEEK, isDefault: true }
          : hours,
      ),
    ),
    listDaysOff: vi.fn(() =>
      Promise.resolve(daysOff.map((d, i) => ({ id: `d${i}`, name: 'Nghỉ', ...d }))),
    ),
  };
}
const open = (s: ReturnType<typeof store>, at: Date) =>
  workspaceOpenAt(tx, s as unknown as BusinessHoursStore, 'w1', at);

describe('workspaceOpenAt', () => {
  it('is open in the hours of the week of the workspace, in its time zone, and closed outside them', async () => {
    expect(await open(store(), TUESDAY_10H)).toBe(true);
    expect(await open(store(), SATURDAY_10H)).toBe(false);
    expect(await open(store(), AFTER_MIDNIGHT)).toBe(false);
  });

  it('is closed on a day off, and reads only the days off that end on the local date or later', async () => {
    const s = store([{ startsOn: '2026-11-02', endsOn: '2026-11-03' }]);
    expect(await open(s, TUESDAY_10H)).toBe(false);
    expect(s.listDaysOff).toHaveBeenCalledWith(tx, 'w1', '2026-11-03');
    const late = store();
    await open(late, AFTER_MIDNIGHT);
    expect(late.listDaysOff).toHaveBeenCalledWith(tx, 'w1', '2026-11-04');
  });

  it('fails loud when the workspace is not visible', async () => {
    await expect(open(store([], null), TUESDAY_10H)).rejects.toThrow('not visible');
  });
});
