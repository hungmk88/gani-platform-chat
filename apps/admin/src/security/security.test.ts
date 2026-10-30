import { describe, expect, it } from 'vitest';

import { ALERT_KIND, SEVERITY } from './labels';
import { alertsPath, incidentsPath, timeText } from './security';

describe('Bảo mật (#29)', () => {
  it('always sends the status of the incidents, and no filter for the alerts (U68)', () => {
    expect(incidentsPath('open', null)).toBe('/v1/security-incidents?status=open&limit=50');
    expect(incidentsPath('closed', 'c 2')).toBe(
      '/v1/security-incidents?status=closed&limit=50&cursor=c+2',
    );
    expect(alertsPath(null)).toBe('/v1/security-alerts?limit=50');
    expect(alertsPath('c2')).toBe('/v1/security-alerts?limit=50&cursor=c2');
  });

  it('has a word for every kind and every severity, the edited one included (CEO 30/10)', () => {
    expect(Object.values(ALERT_KIND).every(Boolean)).toBe(true);
    expect(ALERT_KIND.platform_access).toBe('Truy cập từ quản trị nền tảng');
    expect(Object.values(SEVERITY).map(([w]) => w)).toEqual([
      'Thấp',
      'Trung bình',
      'Cao',
      'Nghiêm trọng',
    ]);
  });

  it('writes times in Viet Nam, a missing one as a dash', () => {
    expect(timeText('2026-10-29T17:30:00.000Z')).toBe('00:30 30/10/2026');
    expect(timeText(null)).toBe('—');
  });
});
