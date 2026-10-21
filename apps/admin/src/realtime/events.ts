// The packets of Socket.IO /agent (realtime spec §3, apps/worker realtime-handlers.ts) and how each one changes the cache.
// Kept out of React so every rule is tested: a packet may come twice or late, so nothing older replaces something newer.
import type { InfiniteData } from '@tanstack/react-query';

import type { components } from '../api/schema';
import type { Message } from '../inbox/messages';

type Conversation = components['schemas']['Conversation'];
type MessagePage = components['schemas']['MessagePage'];

/** What every packet carries (spec §3); only `data` is read here. */
export interface Envelope<T> {
  readonly eventId: string;
  readonly type: string;
  readonly aggregateVersion: number;
  readonly data: T;
}
export interface StateChanged {
  readonly conversationId: string;
  readonly to: Conversation['state'];
  readonly hold: boolean;
  readonly version: number;
  readonly assignedUserId: string | null;
}
export interface Assigned {
  readonly conversationId: string;
}
/** Sent to the conversation's room in full; the workspace's room gets only ids and numbers, never the text (R3). */
export interface MessageCreated {
  readonly conversationId: string;
  readonly messageId?: string;
  readonly sequenceNumber: number;
  readonly senderKind: Message['senderKind'];
  readonly senderUserId?: string | null;
  readonly kind?: Message['kind'];
  readonly body?: string | null;
  readonly platformSentAt?: string | null;
  readonly createdAt: string;
}

/** The message of a full packet, or null for the workspace's summary. */
export function messageOf(d: MessageCreated): Message | null {
  if (!d.messageId || !d.kind) return null;
  return {
    id: d.messageId,
    sequenceNumber: d.sequenceNumber,
    senderKind: d.senderKind,
    senderUserId: (d.senderUserId ?? null) as string,
    kind: d.kind,
    body: d.body ?? null,
    platformSentAt: d.platformSentAt ?? null,
    createdAt: d.createdAt,
  };
}

/** The pages of messages with one more; a number already there is left as it is (a packet seen twice, or also read by REST). */
export function withMessage(
  pages: InfiniteData<MessagePage> | undefined,
  m: Message,
): InfiniteData<MessagePage> | undefined {
  if (!pages || pages.pages.some((p) => p.data.some((x) => x.sequenceNumber === m.sequenceNumber)))
    return pages;
  const [first, ...rest] = pages.pages;
  if (!first) return pages;
  return { ...pages, pages: [{ ...first, data: [m, ...first.data] }, ...rest] };
}

/** The highest message number held, for `resume` (0: nothing held yet). */
export const lastSequence = (pages: InfiniteData<MessagePage> | undefined) =>
  Math.max(0, ...(pages?.pages.flatMap((p) => p.data.map((m) => m.sequenceNumber)) ?? []));

/** The conversation after a state change, unless the cache already has this version or a newer one. */
export function withState(c: Conversation | undefined, d: StateChanged): Conversation | undefined {
  if (!c || d.version <= c.version) return c;
  return {
    ...c,
    state: d.to,
    afterHoursHold: d.hold,
    version: d.version,
    assignedUserId: d.assignedUserId as string,
  };
}
