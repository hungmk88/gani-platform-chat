import { describe, expect, it } from 'vitest';

import { choiceCookie, pickWorkspace } from './workspace-choice';

const mine = [
  { id: 'w1', name: 'B2B', contactPhone: null },
  { id: 'w2', name: 'CSKH', contactPhone: null },
];

describe('pickWorkspace', () => {
  it('keeps a choice that is still theirs, else takes the first; none for one who has none', () => {
    expect(pickWorkspace(mine, 'w2')).toBe('w2');
    expect(pickWorkspace(mine, 'w-of-another-company')).toBe('w1');
    expect(pickWorkspace(mine, undefined)).toBe('w1');
    expect(pickWorkspace([], 'w1')).toBeNull();
  });
});

describe('choiceCookie', () => {
  it('keeps the id for the whole admin, escaped', () => {
    expect(choiceCookie('w 1;x')).toBe('gani_ws=w%201%3Bx; Path=/; Max-Age=31536000; SameSite=Lax');
  });
});
