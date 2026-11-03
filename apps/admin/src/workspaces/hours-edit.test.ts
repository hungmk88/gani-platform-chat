import { describe, expect, it } from 'vitest';

import { NO_HOURS } from './hours';
import { draftOf, hoursProblem, sameWeek, weekOf, type DayDraft } from './hours-edit';

const open = (weekday: number, more: Partial<DayDraft> = {}): DayDraft => ({
  weekday,
  open: true,
  opensAt: '08:00',
  closesAt: '18:00',
  breakStartsAt: '',
  breakEndsAt: '',
  ...more,
});
const shut = (weekday: number) => ({ weekday, open: false, ...NO_HOURS });
const sent = (weekday: number, b: string | null = null, e: string | null = null) => ({
  ...open(weekday),
  breakStartsAt: b,
  breakEndsAt: e,
});
const breakOf = (b: string, e: string) => open(1, { breakStartsAt: b, breakEndsAt: e });

describe('changing the business hours', () => {
  it('reads the week by weekday, the hours as the inputs hold them', () => {
    const week = [shut(7), sent(1, '12:00', '13:00')];
    expect(draftOf({ timezone: 'Asia/Ho_Chi_Minh', isDefault: true, week })).toEqual([
      breakOf('12:00', '13:00'),
      { ...open(7), open: false, opensAt: '', closesAt: '' },
    ]);
  });

  it('sends a closed day without hours, even those left in its inputs, and an empty break as none', () => {
    const draft = [
      open(1),
      { ...open(2), open: false, closesAt: '07:00' },
      open(3, { breakStartsAt: '12:00', breakEndsAt: '13:00' }),
    ];
    expect(weekOf(draft)).toEqual([sent(1), shut(2), sent(3, '12:00', '13:00')]);
    expect(hoursProblem(draft)).toBeNull();
  });

  it('opening before closing, strictly; both hours of an open day', () => {
    expect(hoursProblem([open(2, { closesAt: '07:00' })])).toBe(
      'Thứ 3: giờ đóng cửa phải sau giờ mở cửa.',
    );
    expect(hoursProblem([open(2, { closesAt: '08:00' })])).toBe(
      'Thứ 3: giờ đóng cửa phải sau giờ mở cửa.',
    );
    expect(hoursProblem([open(1, { closesAt: '' })])).toBe(
      'Thứ 2: nhập giờ mở cửa và giờ đóng cửa.',
    );
    expect(hoursProblem([open(6, { opensAt: '', closesAt: '' })])).toBe(
      'Thứ 7: nhập giờ mở cửa và giờ đóng cửa.',
    );
    expect(hoursProblem([open(1, { opensAt: '00:00', closesAt: '23:59' })])).toBeNull();
  });

  it('a break of both ends or none, strictly inside the day', () => {
    expect(hoursProblem([breakOf('12:00', '13:00')])).toBeNull();
    expect(hoursProblem([breakOf('08:01', '17:59')])).toBeNull();
    expect(hoursProblem([open(3, { breakEndsAt: '13:00' })])).toBe(
      'Thứ 4: nhập đủ hai giờ nghỉ giữa ca, hoặc để trống cả hai.',
    );
    for (const [b, e] of [
      ['07:00', '09:00'],
      ['08:00', '09:00'],
      ['17:00', '18:00'],
      ['17:00', '19:00'],
      ['13:00', '12:00'],
      ['12:00', '12:00'],
    ] as const)
      expect(hoursProblem([breakOf(b, e)]), `${b}–${e}`).toBe(
        'Thứ 2: giờ nghỉ giữa ca phải nằm trong giờ làm việc.',
      );
  });

  it('says the first day the API would refuse, by weekday', () => {
    expect(hoursProblem([open(1), open(4, { closesAt: '07:00' }), open(7, { opensAt: '' })])).toBe(
      'Thứ 5: giờ đóng cửa phải sau giờ mở cửa.',
    );
  });

  it('a closed day keeps its hours in the form but they change nothing sent', () => {
    expect(
      sameWeek([{ ...open(6), open: false }], [{ ...open(6), open: false, opensAt: '' }]),
    ).toBe(true);
    expect(sameWeek([open(1)], [open(1, { closesAt: '17:00' })])).toBe(false);
  });
});
