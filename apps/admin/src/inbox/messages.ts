// The messages of an open conversation (#6 middle column): order and words, kept out of React so they are tested.
import type { components } from '../api/schema';

export type Message = components['schemas']['Message'];

/**
 * The order a person reads (Brief P10 step 2): by the time the platform sent it, then by arrival. A Zalo message that comes
 * late gets a higher sequenceNumber but stands where it was sent. Without platformSentAt (an agent's own message) the time it
 * was stored stands in. `platformMessageId` of P10 is not served by the API yet, so the sequence number breaks a tie.
 */
export function inReadingOrder(pages: readonly (readonly Message[])[]): Message[] {
  const seen = new Map<number, Message>();
  for (const page of pages) for (const m of page) seen.set(m.sequenceNumber, m);
  const at = (m: Message) => Date.parse(m.platformSentAt ?? m.createdAt);
  return [...seen.values()].sort((a, b) => at(a) - at(b) || a.sequenceNumber - b.sequenceNumber);
}

/** Who wrote it. Names of people wait for U30, as in the list. */
export function senderOf(
  m: Pick<Message, 'senderKind'> & { readonly senderUserId: string | null },
  meId: string,
) {
  if (m.senderKind === 'customer') return 'Khách';
  if (m.senderKind === 'bot') return 'Bot';
  if (m.senderKind === 'system') return 'Hệ thống';
  return m.senderUserId === meId ? 'Tôi' : 'Nhân viên';
}

/** What stands for a message that is not text; the file and image viewers come with signed links (Brief UI §2.6). */
export const KIND_LABEL: Readonly<Record<Message['kind'], string | null>> = {
  text: null,
  system: null,
  image: 'Ảnh',
  file: 'Tệp',
  sticker: 'Nhãn dán',
  postback: 'Khách bấm nút',
};

/** `GET /v1/conversations/{id}/messages`, newest first, one page back per cursor. */
export const messagesPath = (id: string, cursor: string | null) =>
  `/v1/conversations/${encodeURIComponent(id)}/messages?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
