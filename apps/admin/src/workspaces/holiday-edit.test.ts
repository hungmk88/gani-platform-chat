import { describe, expect, it } from 'vitest';

import { holidayChangeOf, holidayOf } from './holiday-edit';

const tet = { id: 'h-1', name: 'Tết', startsOn: '2030-02-01', endsOn: '2030-02-07' };
const day = (name: string, startsOn: string, endsOn: string) => ({ name, startsOn, endsOn });

describe('changing the days off', () => {
  it('checks a day off as the API: a trimmed name of 1–100, both dates, the end on or after the start', () => {
    expect(holidayOf(day('  Tết ', '2030-02-01', '2030-02-01'))).toEqual(
      day('Tết', '2030-02-01', '2030-02-01'),
    );
    expect(holidayOf(day('x'.repeat(100), '2030-02-01', '2030-02-01'))).not.toBeTypeOf('string');
    expect(holidayOf(day('   ', '2030-02-01', '2030-02-01'))).toBe('Nhập tên ngày nghỉ.');
    expect(holidayOf(day('x'.repeat(101), '2030-02-01', '2030-02-01'))).toBe(
      'Tên ngày nghỉ tối đa 100 ký tự.',
    );
    expect(holidayOf(day('Tết', '', '2030-02-01'))).toBe('Chọn ngày bắt đầu và ngày kết thúc.');
    expect(holidayOf(day('Tết', '2030-02-02', '2030-02-01'))).toBe(
      'Ngày kết thúc phải từ ngày bắt đầu trở đi.',
    );
  });

  it('changes only what changed, nothing when nothing did', () => {
    expect(holidayChangeOf(tet, { ...tet, endsOn: '2030-02-08' })).toEqual({
      endsOn: '2030-02-08',
    });
    expect(holidayChangeOf(tet, { ...tet, name: ' Tết ' })).toEqual({});
    expect(holidayChangeOf(tet, { ...tet, name: 'Tết Bính Ngọ', startsOn: '2030-01-31' })).toEqual({
      name: 'Tết Bính Ngọ',
      startsOn: '2030-01-31',
    });
    expect(holidayChangeOf(tet, { ...tet, startsOn: '2030-02-09' })).toBe(
      'Ngày kết thúc phải từ ngày bắt đầu trở đi.',
    );
  });
});
