import { describe, expect, it } from 'vitest';

import { ROLES } from '../nav';
import {
  confirmsMerge,
  mayMerge,
  maySeeMerges,
  maySeeSuggestions,
  mergeLineOf,
  mergeFailureOf,
  mergePreview,
  mergesPath,
  REASON,
  sameCustomer,
  suggestionsPath,
  unmergeFailureOf,
  unmergePath,
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

describe('merging (PR B1)', () => {
  const kept = { id: 'k', displayName: 'Nguyễn Văn An', phone: null, email: 'an@example.test' };
  const merged = {
    id: 'm',
    displayName: 'An Nguyễn',
    phone: '+84900000001',
    email: 'an2@example.test',
  };

  it('only an Owner or an Admin gets the button, stricter than the API (CEO brief 153, 155)', () => {
    expect(ROLES.filter(mayMerge)).toEqual(['owner', 'admin']);
  });

  it('the merged one fills only what the kept one lacks', () => {
    expect(mergePreview(kept, merged)).toEqual({
      displayName: 'Nguyễn Văn An',
      phone: '+84900000001',
      email: 'an@example.test',
    });
    expect(mergePreview({ ...kept, displayName: null }, merged).displayName).toBe('An Nguyễn');
  });

  it('GOP, ends trimmed and any case; and never the same customer twice', () => {
    expect([' gop ', 'GOP', 'Gop'].every(confirmsMerge)).toBe(true);
    expect(['GO', 'GOPP', 'G O P', ''].some(confirmsMerge)).toBe(false);
    expect(sameCustomer('k', 'k')).toBe('Phải chọn hai khách khác nhau.');
    expect(sameCustomer('k', 'm')).toBeNull();
  });

  it('says why it failed, and which failures leave nothing to try', () => {
    const f = (code: string, status: number) => mergeFailureOf({ code, status, message: 'API' });
    expect(f('not_found', 404)).toEqual({
      text: 'Một trong hai khách không còn (đã gộp hoặc đã xóa). Danh sách gợi ý đã tải lại.',
      final: true,
    });
    expect(f('forbidden', 403)).toEqual({ text: 'API', final: true });
    expect(f('internal_error', 500).final).toBe(false);
    expect(f('network_error', 0).text).toContain('không gộp hai lần');
    expect(f('idempotency_in_progress', 409)).toEqual({ text: 'API', final: false });
  });
});

describe('unmerging (PR B2)', () => {
  it('posts on the source, the customer merged away', () => {
    expect(unmergePath('s/1')).toBe('/v1/customers/s%2F1/unmerge');
  });

  it('says why it was refused; 409 and 404 leave nothing to try, a lost answer may be tried again', () => {
    const f = (code: string, status: number) => unmergeFailureOf({ code, status, message: 'API' });
    expect(f('not_merged', 409)).toEqual({
      text: 'Lần gộp này đã được tách trước đó. Lịch sử gộp đã tải lại.',
      final: true,
    });
    expect(f('target_merged', 409).text).toBe(
      'Khách này đã được gộp tiếp vào khách khác. Tách lần gộp đó trước.',
    );
    expect(f('not_found', 404)).toEqual({ text: 'Không còn khách này.', final: true });
    expect(f('forbidden', 403)).toEqual({ text: 'API', final: true });
    expect(f('internal_error', 500)).toEqual({
      text: 'Chưa rõ đã tách hay chưa. Bấm Thử lại: an toàn, không tách hai lần.',
      final: false,
    });
    expect(f('idempotency_in_progress', 409)).toEqual({ text: 'API', final: false });
  });
});
