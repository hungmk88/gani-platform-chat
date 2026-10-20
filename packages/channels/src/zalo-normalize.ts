import { createHash } from 'node:crypto';

import type { ZaloEvent } from './zalo.js';

// From a Zalo webhook to what the inbound processor stores (inbound spec §3 steps 1–2, I7). Q6: unverified (Z-e): the event names and
// the fields below are what the fixtures assume, not what Zalo documents; see the note at the top of zalo.ts.

export type InboundKind = 'text' | 'image' | 'file' | 'sticker';

export type NormalizedInbound =
  | {
      readonly kind: 'message';
      /** The customer: the id of the person on this channel account (conversations.external_user_id). */
      readonly externalUserId: string;
      readonly platformMessageId: string;
      readonly messageKind: InboundKind;
      /** Unicode NFC; null for an image, a file or a sticker (I7: nothing is downloaded, the payload keeps the reference). */
      readonly body: string | null;
      readonly platformSentAt: Date;
    }
  /** Not a message of a customer (a follow, a read receipt, …): kept as `ignored` with a fixed reason, never a conversation. */
  | { readonly kind: 'ignored'; readonly reason: IgnoredReason };

/** Fixed codes for `inbound_events.last_error` (^[A-Z][A-Z0-9_]{0,63}$): never a value of the payload. */
export type IgnoredReason = 'I_NOT_A_MESSAGE' | 'I_NO_SENDER' | 'I_NO_TEXT';

// Q6: unverified (Z-e)
const KINDS: Readonly<Record<string, InboundKind>> = {
  user_send_text: 'text',
  user_send_image: 'image',
  user_send_file: 'file',
  user_send_sticker: 'sticker',
};

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
 * The key against a second delivery of one event (inbound_event_keys, I1): the platform's message id, or `raw:` + sha256 of the raw
 * body when the event has none (I5). Read at the webhook, before anything is stored.
 */
export function zaloPlatformMessageId(event: ZaloEvent, rawBody: Buffer): string {
  return (
    text(field(field(event.raw, 'message'), 'msg_id')) ?? // Q6: unverified (Z-e)
    `raw:${createHash('sha256').update(rawBody).digest('hex')}`
  );
}

export function normalizeZalo(event: ZaloEvent, rawBody: Buffer): NormalizedInbound {
  const messageKind = KINDS[event.eventName];
  if (!messageKind) return { kind: 'ignored', reason: 'I_NOT_A_MESSAGE' };
  const externalUserId = text(field(field(event.raw, 'sender'), 'id')); // Q6: unverified (Z-e)
  if (!externalUserId) return { kind: 'ignored', reason: 'I_NO_SENDER' };
  const said = text(field(field(event.raw, 'message'), 'text')); // Q6: unverified (Z-e)
  if (messageKind === 'text' && said === undefined) return { kind: 'ignored', reason: 'I_NO_TEXT' };
  return {
    kind: 'message',
    externalUserId,
    platformMessageId: zaloPlatformMessageId(event, rawBody),
    messageKind,
    body: messageKind === 'text' && said !== undefined ? said.normalize('NFC') : null,
    platformSentAt: new Date(Number(event.timestamp)),
  };
}
