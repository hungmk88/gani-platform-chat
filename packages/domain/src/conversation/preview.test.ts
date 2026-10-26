import { describe, expect, it } from 'vitest';

import {
  MESSAGE_KIND_LABEL,
  PREVIEW_GRAPHEMES,
  messagePreview,
  movesPreview,
  previewOf,
} from './preview.js';

const graphemes = (s: string) =>
  [...new Intl.Segmenter('vi', { granularity: 'grapheme' }).segment(s)].length;

describe('messagePreview (U30, N169)', () => {
  it('keeps a short text as it is, NFC', () => {
    expect(messagePreview('text', 'Chị muốn hỏi giá')).toBe('Chị muốn hỏi giá');
    const nfd = 'Chị muốn hỏi giá'.normalize('NFD');
    expect(messagePreview('text', nfd)).toBe('Chị muốn hỏi giá');
  });

  it('cuts a long Vietnamese text in decomposed form at 120 letters, never between a letter and its marks', () => {
    const long = 'Ổn định giá hội thoại '.repeat(20).normalize('NFD');
    const cut = messagePreview('text', long) as string;
    expect(graphemes(cut)).toBeLessThanOrEqual(PREVIEW_GRAPHEMES);
    expect(cut).toBe(cut.normalize('NFC'));
    expect('Ổn định giá hội thoại '.repeat(20).startsWith(cut)).toBe(true);
    expect(cut.endsWith('…')).toBe(false);
  });

  it('never cuts an emoji of several code points (a family, a flag) at the edge', () => {
    for (const emoji of ['👨‍👩‍👧', '🇻🇳', '👍🏽']) {
      const text = `${'a'.repeat(PREVIEW_GRAPHEMES - 1)}${emoji}${emoji}`;
      expect(messagePreview('text', text)).toBe(`${'a'.repeat(PREVIEW_GRAPHEMES - 1)}${emoji}`);
    }
  });

  it('makes every run of spaces and line breaks one space, and gives null for a text of spaces only', () => {
    expect(messagePreview('text', '  Dạ\n\nem   gửi\tbáo giá  ')).toBe('Dạ em gửi báo giá');
    expect(messagePreview('text', ' \n\t ')).toBeNull();
    expect(messagePreview('text', '')).toBeNull();
    expect(messagePreview('text', null)).toBeNull();
  });

  it('stores no text for a message that is not text', () => {
    for (const kind of ['image', 'file', 'sticker', 'postback', 'system'])
      expect(messagePreview(kind, 'x')).toBeNull();
  });
});

describe('previewOf', () => {
  it('gives the stored text for a text, the fixed label for another kind, null before any message', () => {
    expect(previewOf('text', 'Xin chào')).toBe('Xin chào');
    expect(previewOf('text', null)).toBeNull();
    expect(previewOf('image', null)).toBe(MESSAGE_KIND_LABEL.image);
    expect(previewOf('file', null)).toBe('[Tệp]');
    expect(previewOf('sticker', null)).toBe('[Sticker]');
    expect(previewOf('postback', null)).toBe('[Lựa chọn]');
    expect(previewOf(null, null)).toBeNull();
  });
});

describe('movesPreview', () => {
  it('is every message but an event of the system', () => {
    expect(movesPreview('customer', 'text')).toBe(true);
    expect(movesPreview('agent', 'image')).toBe(true);
    expect(movesPreview('bot', 'postback')).toBe(true);
    expect(movesPreview('system', 'text')).toBe(false);
    expect(movesPreview('agent', 'system')).toBe(false);
  });
});
