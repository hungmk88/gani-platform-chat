import { describe, expect, it } from 'vitest';

import { chooseTrigger } from './triggers.js';

// Choosing the flow a message starts (D1b3a): a keyword wins, then first_message on a new conversation, else none.
const flows = [
  { id: 'faq', trigger: { on: 'keyword', keywords: ['giá', ' ', 7, 'Đặt hàng'] } },
  { id: 'welcome', trigger: { on: 'first_message' } },
  { id: 'older', trigger: { on: 'first_message' } },
  { id: 'night', trigger: { on: 'after_hours' } },
  { id: 'odd', trigger: { on: 'keyword', keywords: 'giá' } },
];
const pick = (text: string | null, firstOfConversation = true) =>
  chooseTrigger(flows, { text, firstOfConversation })?.id ?? null;

describe('chooseTrigger', () => {
  it('starts the flow whose keyword the message holds, any case and diacritics, before first_message', () => {
    expect(pick('Cho em hỏi GIA sỉ')).toBe('faq');
    expect(pick('dat hang 5 thung', false)).toBe('faq');
  });

  it('starts the first first_message flow on a new conversation only', () => {
    expect(pick('xin chào')).toBe('welcome');
    expect(pick(null)).toBe('welcome');
    expect(pick('xin chào', false)).toBeNull();
    expect(pick(null, false)).toBeNull();
    expect(chooseTrigger([flows[3]!], { text: 'x', firstOfConversation: true })).toBeNull();
  });
});
