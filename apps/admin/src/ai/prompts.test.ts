import { describe, expect, it } from 'vitest';

import { ROLES } from '../nav';
import { approvalOf, mayReadPrompts } from './prompts';

describe('the prompt versions (#26, E20)', () => {
  it('are for Owner and Admin only, for now (U66)', () => {
    expect(ROLES.filter((r) => mayReadPrompts(r))).toEqual(['owner', 'admin']);
    expect(mayReadPrompts(null)).toBe(false);
  });

  it('say when and by whom a version was approved, in Vietnam time', () => {
    expect(approvalOf({ approvedAt: '2026-10-29T17:30:00.000Z', approvedBy: 'Nguyễn An' })).toEqual(
      {
        when: '00:30 30/10/2026',
        who: 'Nguyễn An',
      },
    );
  });

  it('say a version is not approved instead of a date', () => {
    expect(approvalOf({ approvedAt: null, approvedBy: null })).toEqual({
      when: 'Chưa duyệt',
      who: '—',
    });
  });
});
