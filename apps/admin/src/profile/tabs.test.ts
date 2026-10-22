import { describe, expect, it } from 'vitest';

import { tabOf } from './tabs';

describe('tabOf', () => {
  it('reads a known part and falls back to the first one', () => {
    expect(tabOf('security')).toBe('security');
    expect(tabOf('notify')).toBe('notify');
    expect(tabOf(undefined)).toBe('info');
    expect(tabOf('../../admin')).toBe('info');
  });
});
