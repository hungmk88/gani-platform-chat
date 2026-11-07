import { describe, expect, it } from 'vitest';

import { AGENT_STATUS, stripOf } from './agent-status';

describe('agent status (U82)', () => {
  it('names the three statuses in words, in order', () => {
    expect(Object.values(AGENT_STATUS)).toEqual(['Online', 'Bận', 'Offline']);
  });

  it('says so only when the API set Offline because the connection was lost', () => {
    expect(stripOf({ status: 'offline', reason: 'disconnected' })).toBe(
      'Đã chuyển Offline do mất kết nối. Bật Online khi sẵn sàng.',
    );
    expect(stripOf({ status: 'offline', reason: 'manual' })).toBeNull();
    expect(stripOf({ status: 'online', reason: null })).toBeNull();
  });
});
