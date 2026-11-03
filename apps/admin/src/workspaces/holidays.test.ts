import { describe, expect, it } from 'vitest';

import { dayText, holidayPath, holidaysPath, spanText } from './holidays';

describe('days off as read', () => {
  it('writes dates as the screen does, one day or a span', () => {
    expect(dayText('2030-02-01')).toBe('01/02/2030');
    expect(spanText({ startsOn: '2030-02-01', endsOn: '2030-02-07' })).toBe(
      '01/02/2030 – 07/02/2030',
    );
    expect(spanText({ startsOn: '2030-01-01', endsOn: '2030-01-01' })).toBe('01/01/2030');
  });

  it('puts the ids in the paths, encoded', () => {
    expect(holidaysPath('ws/1')).toBe('/v1/workspaces/ws%2F1/holidays');
    expect(holidayPath('ws/1', 'h 1')).toBe('/v1/workspaces/ws%2F1/holidays/h%201');
  });
});
