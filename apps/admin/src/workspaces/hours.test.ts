import { describe, expect, it } from 'vitest';

import { cellText, hoursPath, NO_HOURS } from './hours';

describe('business hours as read', () => {
  const open = {
    weekday: 1,
    open: true,
    opensAt: '08:00',
    closesAt: '18:00',
    breakStartsAt: '12:00',
    breakEndsAt: null,
  };
  const closed = { weekday: 7, open: false, ...NO_HOURS };

  it('says a day open or closed, its hours, and "—" for none', () => {
    expect(cellText(open, 'open')).toBe('Có');
    expect(cellText(closed, 'open')).toBe('Nghỉ');
    expect(cellText(open, 'opensAt')).toBe('08:00');
    expect(cellText(open, 'breakStartsAt')).toBe('12:00');
    expect(cellText(open, 'breakEndsAt')).toBe('—');
    expect(cellText(closed, 'closesAt')).toBe('—');
  });

  it('puts the workspace id in the path, encoded', () => {
    expect(hoursPath('ws/1')).toBe('/v1/workspaces/ws%2F1/business-hours');
  });
});
