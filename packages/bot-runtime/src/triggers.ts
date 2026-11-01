// Which flow a customer's message starts when no session runs (D1b3a, A 01/11/2026, N184): a flow whose keyword the message holds
// (any case, any diacritics) wins; else, on the first message of a new conversation, a first_message flow. The candidates come in
// the order the caller wants (the flow changed last first), and the first that fits is taken. intent is Đợt 2 (it needs AI);
// after_hours waits for a schedule of business hours (C8/C10). No flow fits → null, and the caller hands over.

import { foldText } from './nodes.js';

export interface TriggerCandidate {
  readonly trigger: Readonly<Record<string, unknown>>;
}

const keywordsOf = (trigger: Readonly<Record<string, unknown>>): readonly string[] =>
  trigger.on === 'keyword' && Array.isArray(trigger.keywords)
    ? trigger.keywords.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
    : [];

export function chooseTrigger<T extends TriggerCandidate>(
  candidates: readonly T[],
  message: { readonly text: string | null; readonly firstOfConversation: boolean },
): T | null {
  const text = message.text === null ? '' : foldText(message.text);
  const byKeyword =
    text === ''
      ? undefined
      : candidates.find((c) => keywordsOf(c.trigger).some((k) => text.includes(foldText(k))));
  if (byKeyword) return byKeyword;
  if (!message.firstOfConversation) return null;
  return candidates.find((c) => c.trigger.on === 'first_message') ?? null;
}
