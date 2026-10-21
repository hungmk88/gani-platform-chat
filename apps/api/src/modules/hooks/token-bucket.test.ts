import { describe, expect, it } from 'vitest';

import { TokenBuckets } from './token-bucket.js';

describe('TokenBuckets (zalo spec §3, Z7)', () => {
  it('lets a burst through, refuses the next one, and refills at the rate', () => {
    const buckets = new TokenBuckets({ perSecond: 10, burst: 3 });
    expect([1, 2, 3, 4].map(() => buckets.take('a', 0))).toEqual([true, true, true, false]);
    expect(buckets.take('b', 0)).toBe(true);
    expect(buckets.take('a', 50)).toBe(false);
    expect(buckets.take('a', 100)).toBe(true);
    expect(buckets.take('a', 100_000)).toBe(true);
  });

  it('keeps at most maxKeys buckets, dropping the one used longest ago', () => {
    const buckets = new TokenBuckets({ perSecond: 1, burst: 1, maxKeys: 2 });
    expect(buckets.take('a', 0)).toBe(true);
    expect(buckets.take('b', 0)).toBe(true);
    expect(buckets.take('c', 0)).toBe(true);
    expect(buckets.take('a', 0)).toBe(true); // a was dropped, so it starts full again
    expect(buckets.take('c', 0)).toBe(false);
  });
});
