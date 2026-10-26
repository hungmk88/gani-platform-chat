import { describe, expect, it } from 'vitest';

import { mayManageQuickReplies, quickRepliesPath, usedText } from './quick-replies';

describe('quickRepliesPath', () => {
  it('asks one workspace, the start of a shortcut as typed in lower case, and a tag', () => {
    expect(quickRepliesPath('w1', { q: '', tag: null })).toBe('/v1/quick-replies?workspaceId=w1');
    expect(quickRepliesPath('w1', { q: ' Gia ', tag: 'báo giá' })).toBe(
      '/v1/quick-replies?workspaceId=w1&q=gia&tag=b%C3%A1o+gi%C3%A1',
    );
    expect(quickRepliesPath('w1', { q: 'x'.repeat(40), tag: null })).toBe(
      `/v1/quick-replies?workspaceId=w1&q=${'x'.repeat(32)}`,
    );
  });
});

describe('mayManageQuickReplies and usedText', () => {
  it('lets Owner, Admin and Manager manage templates (Phụ lục B)', () => {
    expect(['owner', 'admin', 'manager'].every((r) => mayManageQuickReplies(r as 'owner'))).toBe(
      true,
    );
    expect(mayManageQuickReplies('sales')).toBe(false);
    expect(mayManageQuickReplies(null)).toBe(false);
  });

  it('says how often a template was used', () => {
    expect(usedText(0)).toBe('Chưa dùng lần nào');
    expect(usedText(3)).toBe('Đã dùng 3 lần');
  });
});
