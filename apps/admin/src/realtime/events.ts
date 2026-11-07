// The packets of Socket.IO /agent (realtime spec §3, apps/worker realtime-handlers.ts) and how each one changes the cache.
// Kept out of React so every rule is tested: a packet may come twice or late, so nothing older replaces something newer.
import type { InfiniteData } from '@tanstack/react-query';

import type { AgentStatus } from '../agent-status';
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

/** An agent's status changed (U86, planned S4): to `user:{userId}` and `ws:{wsId}`; the rest is `AgentStatus` of U82. */
export interface AgentStatusChanged extends AgentStatus {
  readonly userId: string;
}
/** A conversation's SLA changed (U86, planned S4): to `conv:{id}` and `ws:{wsId}`; `sla` is `Conversation.sla` of U81. */
export interface SlaChanged {
  readonly conversationId: string;
  readonly sla: Conversation['sla'];
}

/**
 * Whether a packet is newer than every one seen for its aggregate (`key`), noting it if so (spec §3: a packet may come twice or
 * out of order; the client drops one whose `aggregateVersion` is not above the one it has). For the packets of U86, whose `data`
 * carries no version of its own.
 */
export function fresh(seen: Map<string, number>, key: string, aggregateVersion: number): boolean {
  if (aggregateVersion <= (seen.get(key) ?? -Infinity)) return false;
  seen.set(key, aggregateVersion);
  return true;
}

/** The signed-in agent's own status from a packet about them; one about someone else leaves it as it is. */
export function withAgentStatus(
  s: AgentStatus | undefined,
  d: AgentStatusChanged,
  me: string,
): AgentStatus | undefined {
  if (d.userId !== me) return s;
  return { status: d.status, since: d.since, reason: d.reason };
}

/** The conversation with the SLA of the packet (only that field: the rest is not in the packet). */
export function withSla<C extends { readonly id: string; readonly sla?: Conversation['sla'] }>(
  c: C | undefined,
  d: SlaChanged,
): C | undefined {
  return c && c.id === d.conversationId ? { ...c, sla: d.sla } : c;
}

/** Pages of a list of conversations with that one's SLA changed; anything else under the key (not pages of rows) is left. */
export function withSlaInPages(value: unknown, d: SlaChanged): unknown {
  const pages = (value as { pages?: unknown } | undefined)?.pages;
  if (!Array.isArray(pages)) return value;
  let changed = false;
  const next = (pages as { data?: unknown }[]).map((p) => {
    const rows = p?.data;
    if (!Array.isArray(rows) || !rows.some((r: { id?: string }) => r?.id === d.conversationId))
      return p;
    changed = true;
    return { ...p, data: (rows as { id: string }[]).map((r) => withSla(r, d)) };
  });
  return changed ? { ...(value as object), pages: next } : value;
}

/** The message of a full packet, or null for the workspace's summary. */
export function messageOf(d: MessageCreated): Message | null {
  if (!d.messageId || !d.kind) return null;
  return {
    id: d.messageId,
    sequenceNumber: d.sequenceNumber,
    senderKind: d.senderKind,
    senderUserId: d.senderUserId ?? null,
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
    // The event has the id only: a new holder has no name yet (never the old one's), until the conversation is read again.
    assignee:
      d.assignedUserId === c.assignee?.id
        ? c.assignee
        : d.assignedUserId === null
          ? null
          : { id: d.assignedUserId, name: null },
  };
}

/**
 * Read a conversation again after its holder changed, trying twice more with a growing wait (0,5 s then 1 s): one failed read
 * must not leave a stale or missing name until the page is reloaded. If all fail, what the cache has stays (the id's end).
 */
export async function readAgain(
  read: () => Promise<unknown>,
  wait = (ms: number) => new Promise((r) => setTimeout(r, ms)),
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await read();
    } catch {
      if (attempt < 2) await wait(500 * 2 ** attempt);
    }
  }
  return undefined;
}
