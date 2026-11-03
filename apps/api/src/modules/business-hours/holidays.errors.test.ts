import { HolidayInPastError, HolidayOverlapError } from '@gani/db';
import { describe, expect, it } from 'vitest';

import { holidayHttpErrorOf } from './holidays.errors.js';
import { HolidayChangeSchema, HolidayCreateSchema } from './holidays.schemas.js';

describe('holidays', () => {
  it('answers each refusal of the store with its status and code, and leaves any other error as it is', () => {
    const coded = [new HolidayOverlapError(), new HolidayInPastError()].map(
      (e) => holidayHttpErrorOf(e) as { status: number; code: string },
    );
    expect(coded.map(({ status, code }) => [status, code])).toEqual([
      [422, 'holiday_overlap'],
      [422, 'holiday_in_past'],
    ]);
    const other = new Error('x');
    expect(holidayHttpErrorOf(other)).toBe(other);
  });

  it('wants a trimmed name, dates, a start on or before the end, and something to change', () => {
    const day = { name: ' Tết ', startsOn: '2027-02-05', endsOn: '2027-02-10' };
    expect(HolidayCreateSchema.parse(day).name).toBe('Tết');
    for (const bad of [
      { ...day, name: '  ' },
      { ...day, endsOn: '2027-02-04' },
      { ...day, startsOn: '5/2/2027' },
    ])
      expect(HolidayCreateSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(HolidayCreateSchema.safeParse({ ...day, extra: 1 }).success).toBe(false);
    expect(HolidayChangeSchema.safeParse({}).success).toBe(false);
    expect(HolidayChangeSchema.safeParse({ endsOn: '2027-02-11' }).success).toBe(true);
  });
});
