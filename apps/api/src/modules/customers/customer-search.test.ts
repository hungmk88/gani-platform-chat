import { describe, expect, it } from 'vitest';

import { searchOf } from './customer-search.js';

describe('searchOf (N165, U48, U30)', () => {
  it('takes an @ as a whole email in lower case, never the name', () => {
    expect(searchOf('An@X.vn', false)).toEqual({ email: 'an@x.vn' });
    expect(searchOf('Chị Lan@', false)).toEqual({ email: 'chị lan@' });
  });

  it('takes 3 digits or more as the start of a phone, anything else as a part of the name', () => {
    expect(searchOf('0912', false)).toEqual({ phonePrefix: '+84912' });
    expect(searchOf('Lan', false)).toEqual({ name: 'Lan' });
    expect(searchOf('x.vn', false)).toEqual({ name: 'x.vn' });
  });

  it('searches a masked role by name only', () => {
    expect(searchOf('an@x.vn', true)).toEqual({ name: 'an@x.vn' });
    expect(searchOf('0912', true)).toEqual({ name: '0912' });
  });
});
