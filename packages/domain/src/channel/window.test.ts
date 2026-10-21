import { describe, expect, it } from 'vitest';

import { windowState, type ChannelPolicy } from './window.js';

// channel-policy-spec §7: C-N1 (inside, quota left), C-N2 (the edge of the window, a new message of the person), C-N3 (quota used up).
const ADVISORY: ChannelPolicy = {
  freeWindowSeconds: 172_800,
  freeMessageQuota: 8,
  outsideWindowAllowed: true,
};
const CLOSED_OUTSIDE: ChannelPolicy = { ...ADVISORY, outsideWindowAllowed: false };
const LAST = new Date('2026-10-20T08:00:00Z');
const after = (ms: number) => new Date(LAST.getTime() + ms);
const H48 = 172_800_000;

const decide = (now: Date, sent = 0, policy = ADVISORY, last: Date | null = LAST) =>
  windowState({ now, lastCustomerMessageAt: last, officialMessagesSinceCustomer: sent, policy });

describe('windowState', () => {
  it('C-N1: is open inside the window with free messages left', () => {
    expect(decide(after(60_000), 0)).toEqual({ state: 'open', reason: 'within_window' });
    expect(decide(after(H48 - 1), 7)).toEqual({ state: 'open', reason: 'within_window' });
  });

  it('C-N2: closes at exactly the length of the window, and a new message of the person opens it again', () => {
    expect(decide(after(H48), 0)).toEqual({ state: 'paid_only', reason: 'window_expired' });
    expect(decide(after(H48), 0, CLOSED_OUTSIDE)).toEqual({
      state: 'api_closed',
      reason: 'window_expired',
    });
    // The person wrote again one minute before: the window starts from that message and the count is back to 0.
    expect(decide(after(H48), 0, ADVISORY, after(H48 - 60_000)).state).toBe('open');
  });

  it('C-N3: is not open once the free messages are used up, and then follows outside_window_allowed', () => {
    expect(decide(after(1000), 8)).toEqual({ state: 'paid_only', reason: 'quota_exhausted' });
    expect(decide(after(1000), 9, CLOSED_OUTSIDE)).toEqual({
      state: 'api_closed',
      reason: 'quota_exhausted',
    });
  });

  it('is outside the window when the person never wrote, and for a class with no free window', () => {
    expect(decide(after(0), 0, ADVISORY, null)).toEqual({
      state: 'paid_only',
      reason: 'no_customer_message',
    });
    const transaction = {
      freeWindowSeconds: null,
      freeMessageQuota: null,
      outsideWindowAllowed: true,
    };
    expect(decide(after(0), 0, transaction)).toEqual({
      state: 'paid_only',
      reason: 'no_free_window',
    });
  });

  it('has no quota inside the window when the policy sets none, and the window is read from the policy, not fixed', () => {
    expect(decide(after(1000), 500, { ...ADVISORY, freeMessageQuota: null }).state).toBe('open');
    const hour = { ...ADVISORY, freeWindowSeconds: 3600 };
    expect(decide(after(3_599_999), 0, hour).state).toBe('open');
    expect(decide(after(3_600_000), 0, hour).state).toBe('paid_only');
  });
});
