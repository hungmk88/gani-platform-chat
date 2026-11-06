import { describe, expect, it } from 'vitest';

import { creatorText, VERSION_STATE, versionsPath } from './policy-versions';

describe('policy versions (U80)', () => {
  it('asks the versions of one channel and class', () => {
    expect(versionsPath({ channelType: 'zalo_oa', messageClass: 'advisory' })).toBe(
      '/v1/channel-policies/zalo_oa/advisory/versions',
    );
  });

  it('says the state and who added a version in words', () => {
    expect(VERSION_STATE).toEqual({
      scheduled: 'Đã đặt lịch',
      in_force: 'Đang áp dụng',
      past: 'Đã qua',
    });
    expect(creatorText(null, 'me')).toBe('Hệ thống');
    expect(creatorText('me', 'me')).toBe('Bạn');
    expect(creatorText('someone', 'me')).toBe('Người khác');
  });
});
