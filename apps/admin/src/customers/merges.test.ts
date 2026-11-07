import { describe, expect, it } from 'vitest';

import { ROLES } from '../nav';
import {
  maySeeMerges,
  maySeeSuggestions,
  mergeLineOf,
  mergesPath,
  REASON,
  suggestionsPath,
  type MergeEntry,
} from './merges';

const entry = (over: Partial<MergeEntry> = {}): MergeEntry => ({
  id: '0190e000-0000-7000-8000-000000000001',
  sourceId: '0190d000-0000-7000-8000-000000000002',
  targetId: '0190d000-0000-7000-8000-000000000001',
  mergedBy: { id: '0190f000-0000-7000-8000-00000000a1b2', name: 'Lan' },
  mergedAt: '2026-11-07T07:05:00Z',
  unmergedAt: null,
  sourceName: 'An Nguyễn',
  ...over,
});

describe('who sees the merges (N204, N206)', () => {
  it('suggestions for Owner, Admin, Manager; the history for Owner and Admin only', () => {
    expect(ROLES.filter(maySeeSuggestions)).toEqual(['owner', 'admin', 'manager']);
    expect(ROLES.filter(maySeeMerges)).toEqual(['owner', 'admin']);
  });
});

describe('paths and reasons', () => {
  it('asks under the customer, the id encoded', () => {
    expect(suggestionsPath('a/b')).toBe('/v1/customers/a%2Fb/merge-suggestions');
    expect(mergesPath('c1')).toBe('/v1/customers/c1/merges');
  });
  it('says why in words', () => {
    expect(REASON).toEqual({ phone: 'Trùng SĐT', email: 'Trùng email' });
  });
});

describe('mergeLineOf', () => {
  it('reads who was merged, by whom and when, in Viet Nam time', () => {
    expect(mergeLineOf(entry())).toEqual({
      source: 'An Nguyễn',
      by: { text: 'Lan' },
      at: '14:05 07/11/2026',
      undone: null,
    });
  });
  it('a customer nobody named, a member without a name (the end of the id), an undone merge', () => {
    const line = mergeLineOf(
      entry({
        sourceName: null,
        mergedBy: { id: '0190f000-0000-7000-8000-00000000a1b2', name: '  ' },
        unmergedAt: '2026-11-08T03:00:00Z',
      }),
    );
    expect(line.source).toBe('Khách chưa có tên');
    expect(line.by).toEqual({ text: '…a1b2', title: 'Nhân viên chưa có tên' });
    expect(line.undone).toBe('10:00 08/11/2026');
  });
});
