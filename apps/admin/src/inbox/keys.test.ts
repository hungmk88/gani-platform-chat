import { describe, expect, it } from 'vitest';

import { neighbour, openId } from './keys';

describe('neighbour', () => {
  const ids = ['a', 'b', 'c'];

  it('moves one step in the order of the list, and stops at the ends', () => {
    expect(neighbour(ids, 'a', 1)).toBe('b');
    expect(neighbour(ids, 'b', -1)).toBe('a');
    expect(neighbour(ids, 'c', 1)).toBeNull();
    expect(neighbour(ids, 'a', -1)).toBeNull();
  });

  it('opens the first (J) or the last (K) when none of the list is open', () => {
    expect(neighbour(ids, null, 1)).toBe('a');
    expect(neighbour(ids, 'gone', -1)).toBe('c');
    expect(neighbour([], null, 1)).toBeNull();
  });
});

describe('openId', () => {
  it('reads the open conversation from the path', () => {
    expect(openId('/inbox/0190a')).toBe('0190a');
    expect(openId('/inbox')).toBeNull();
  });
});
