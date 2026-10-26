import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Message } from './messages';
import { titleFromMessages, titleOf, TITLE_MAX } from './ticket-title';

describe('titleOf', () => {
  it('keeps the first line that is not blank, its spaces folded', () => {
    expect(titleOf('\n  Giao   thiếu 2 thùng\nCảm ơn')).toBe('Giao thiếu 2 thùng');
    expect(titleOf('Giao\tthiếu\u0007 hàng tháng 10')).toBe('Giao thiếu hàng tháng 10');
  });

  it('leaves a message too short to say anything empty', () => {
    expect(titleOf('ok')).toBe('');
    expect(titleOf('vâng ạ 👍')).toBe('');
  });

  it('cuts at the last space before 80 characters, else at 80, and adds "…"', () => {
    const words = 'Đơn hàng giao thiếu '.repeat(6); // 120 characters
    const cut = titleOf(words);
    expect(cut.endsWith('…')).toBe(true);
    expect(
      [...new Intl.Segmenter('vi', { granularity: 'grapheme' }).segment(cut)].length,
    ).toBeLessThanOrEqual(TITLE_MAX + 1);
    expect(cut).not.toMatch(/ …$/);
    expect(titleOf('x'.repeat(100))).toBe(`${'x'.repeat(80)}…`);
  });

  it('keeps exactly 80 characters whole, and cuts 81 with no space hard at 80', () => {
    expect(titleOf('x'.repeat(80))).toBe('x'.repeat(80));
    expect(titleOf('😀'.repeat(80))).toBe('😀'.repeat(80)); // 80 graphemes, 160 UTF-16 units
    expect(titleOf('x'.repeat(81))).toBe(`${'x'.repeat(80)}…`);
  });

  it('never cuts an emoji joined by ZWJ or a combining mark in two', () => {
    const family = '👨‍👩‍👧';
    const t = titleOf(`${'a'.repeat(79)}${family}${'b'.repeat(10)}`);
    expect(t).toBe(`${'a'.repeat(79)}${family}…`);
    const combining = 'ế'; // ế written with combining marks
    expect(titleOf(`${'a'.repeat(79)}${combining}zzzz`)).toBe(`${'a'.repeat(79)}${combining}…`);
  });

  it('keeps markup as words: nothing is rendered', () => {
    expect(titleOf('<script>alert(1)</script> **gấp**')).toBe('<script>alert(1)</script> **gấp**');
  });
});

describe('titleFromMessages', () => {
  const msg = (
    n: number,
    senderKind: Message['senderKind'],
    kind: Message['kind'],
    body: string | null,
  ): Message => ({
    id: `m${n}`,
    sequenceNumber: n,
    senderKind,
    senderUserId: null,
    kind,
    body,
    platformSentAt: null,
    createdAt: `2026-10-27T03:00:0${n}.000Z`,
    deliveryStatus: null,
  });

  it("takes the customer's last text message, in reading order", () => {
    const page = [
      msg(3, 'agent', 'text', 'Dạ em kiểm tra ngay'),
      msg(2, 'customer', 'image', null),
      msg(1, 'customer', 'text', 'Hóa đơn tháng 9 bị sai mã số thuế'),
    ];
    expect(titleFromMessages(page)).toBe('Hóa đơn tháng 9 bị sai mã số thuế');
  });

  it('is empty when the newest page (50) has no text from the customer: older pages are not read', () => {
    expect(titleFromMessages([msg(1, 'agent', 'text', 'Chào anh chị, em có thể giúp gì?')])).toBe(
      '',
    );
    expect(titleFromMessages([])).toBe('');
  });
});

describe('titleOf without Intl.Segmenter (Firefox before 125)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('counts code points: surrogate pairs stay whole, the same limits hold', async () => {
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    vi.resetModules();
    const { titleOf: fallback } = await import('./ticket-title');
    expect(fallback('x'.repeat(80))).toBe('x'.repeat(80));
    expect(fallback('x'.repeat(81))).toBe(`${'x'.repeat(80)}…`);
    expect(fallback('ok')).toBe('');
    expect(fallback(`${'a'.repeat(79)}😀${'b'.repeat(5)}`)).toBe(`${'a'.repeat(79)}😀…`);
    expect(fallback(`${'Đơn hàng giao thiếu '.repeat(6)}`)).toMatch(/^Đơn hàng.*thiếu…$/);
  });
});
