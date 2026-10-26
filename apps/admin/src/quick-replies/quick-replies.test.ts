import { describe, expect, it } from 'vitest';

import { errorOf } from '../api/errors';
import {
  insertVariable,
  mayManageQuickReplies,
  missingOf,
  previewPath,
  quickReplyChangeOf,
  quickRepliesPath,
  quickReplyDraftOf,
  quickReplyError,
  unknownVariables,
  usedText,
} from './quick-replies';

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

describe('quickReplyDraftOf', () => {
  it('trims like the API, drops a leading "/", and leaves out no tags', () => {
    expect(quickReplyDraftOf('w1', ' /chao ', '  Xin chào {{customer_name}} ', '')).toEqual({
      workspaceId: 'w1',
      shortcut: 'chao',
      body: 'Xin chào {{customer_name}}',
    });
    expect(quickReplyDraftOf('w1', 'gia-si', 'Giá sỉ', ' báo giá, sỉ ,báo giá,')).toEqual({
      workspaceId: 'w1',
      shortcut: 'gia-si',
      body: 'Giá sỉ',
      tags: ['báo giá', 'sỉ'],
    });
  });

  it('says a wrong shortcut, an empty or long text, a variable of no use and too many tags', () => {
    expect(quickReplyDraftOf('w1', 'Chào', 'x', '')).toMatch(/Phím tắt/);
    expect(quickReplyDraftOf('w1', '-a', 'x', '')).toMatch(/Phím tắt/);
    expect(quickReplyDraftOf('w1', 'a'.repeat(33), 'x', '')).toMatch(/Phím tắt/);
    expect(quickReplyDraftOf('w1', 'a', '  ', '')).toBe('Nhập nội dung mẫu.');
    expect(quickReplyDraftOf('w1', 'a', 'x'.repeat(2001), '')).toMatch(/2000/);
    expect(quickReplyDraftOf('w1', 'a', '{{ ten }} {{agent_name}}', '')).toMatch(/\{\{ten\}\}/);
    expect(quickReplyDraftOf('w1', 'a', 'x', 'a,b,c,d,e,f,g,h,i,j,k')).toMatch(/10 tag/);
    expect(quickReplyDraftOf('w1', 'a', 'x', 'x'.repeat(31))).toMatch(/30 ký tự/);
  });
});

describe('unknownVariables and quickReplyError', () => {
  it('reads the names between braces as the API does, each once', () => {
    expect(unknownVariables('{{ company_phone }} {{x}} {{x}} {{}}')).toEqual(['x', '']);
  });

  it('says a taken shortcut and the other refusals in words of the screen', () => {
    expect(quickReplyError(errorOf(409, { code: 'duplicate_resource' }), 'chao')).toMatch(/\/chao/);
    expect(quickReplyError(errorOf(403, { code: 'forbidden' }), 'a')).toMatch(/Manager/);
    expect(quickReplyError(errorOf(400, { code: 'validation_failed' }), 'a')).toMatch(/không nhận/);
    expect(quickReplyError(errorOf(503, {}), 'a')).toBe(errorOf(503, {}).message);
  });
});

describe('quickReplyChangeOf and insertVariable', () => {
  const reply = {
    id: 'r1',
    workspaceId: 'w1',
    shortcut: 'gia-si',
    body: 'Giá sỉ',
    tags: ['báo giá', 'sỉ'],
    useCount: 0,
    createdAt: '2026-10-26T00:00:00.000Z',
    updatedAt: '2026-10-26T00:00:00.000Z',
  };

  it('sends only what differs, tags compared in order; nothing changed is empty', () => {
    expect(quickReplyChangeOf(reply, 'gia-si', 'Giá sỉ', 'báo giá, sỉ')).toEqual({});
    expect(quickReplyChangeOf(reply, '/gia', ' Giá sỉ ', 'sỉ, báo giá')).toEqual({
      shortcut: 'gia',
      tags: ['sỉ', 'báo giá'],
    });
    expect(quickReplyChangeOf(reply, 'gia-si', 'Giá mới', '')).toEqual({
      body: 'Giá mới',
      tags: [],
    });
    expect(quickReplyChangeOf(reply, 'gia-si', '{{x}}', '')).toMatch(/\{\{x\}\}/);
  });

  it('puts a variable at the caret and says where the caret goes', () => {
    expect(insertVariable('Chào !', 5, 'customer_name')).toEqual({
      text: 'Chào {{customer_name}}!',
      caret: 22,
    });
  });
});

describe('previewPath and missingOf', () => {
  it('asks the preview of one template', () => {
    expect(previewPath('a/b')).toBe('/v1/quick-replies/a%2Fb/preview');
  });
  it('says where each value left out comes from', () => {
    expect(missingOf(['company_phone', 'x'])).toEqual([
      'SĐT công ty: workspace chưa đặt SĐT liên hệ (Cài đặt › Workspace, Owner hoặc Admin).',
      '{{x}}: không điền được.',
    ]);
  });
});
