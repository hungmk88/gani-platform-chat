import { describe, expect, it } from 'vitest';

import { optionsText, tabOf } from './catalog';

describe('the tabs of #23 Dữ liệu khách (brief 33, 46)', () => {
  it('reads a known tab and falls back to the requests on personal data', () => {
    expect(tabOf('fields')).toBe('fields');
    expect(tabOf('tags')).toBe('tags');
    expect(tabOf(undefined)).toBe('requests');
    expect(tabOf('../../admin')).toBe('requests');
  });

  it('says the choices of a field as the API gives them, none as a dash', () => {
    expect(optionsText({ options: ['Zalo', 'Hội chợ'] })).toBe('Zalo, Hội chợ');
    expect(optionsText({ options: [] })).toBe('—');
  });
});
