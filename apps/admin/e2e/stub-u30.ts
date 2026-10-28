// U30 for the e2e stub API only (N169, #367): every conversation it answers gets `channel`, `assignee` and `lastMessagePreview`
// as the API reads them. The channel is the stub's Zalo OA; the holder's name comes from MEMBERS (none for one it does not list,
// e.g. the Manager: as the API, the id with a null name); the preview is the last message that is not a system one, else null.
// Never deployed.
import { CHANNELS } from './stub-channels';
import { MEMBERS } from './stub-members';

const ZALO = CHANNELS.find((c) => c.type === 'zalo_oa')!;

type Row = { readonly id: string; readonly assignedUserId: string | null; readonly state: string };
type Said = {
  readonly senderKind: string;
  readonly body: string | null;
  readonly platformSentAt: string | null;
  readonly createdAt: string;
};

/** The last message in reading order (sent time, else stored time) that is not a system one, folded to one line. */
const preview = (said: readonly Said[] | undefined) => {
  const at = (m: Said) => Date.parse(m.platformSentAt ?? m.createdAt);
  const last = [...(said ?? [])]
    .sort((a, b) => at(b) - at(a))
    .find((m) => m.senderKind !== 'system');
  return last?.body?.replace(/\s+/g, ' ').trim() || null;
};

/** The conversation with its U30 fields; `said` is the messages of the one that has some (#2). */
export function withU30<T extends Row>(c: T, said?: readonly Said[]) {
  const holder = MEMBERS.find((m) => m.userId === c.assignedUserId);
  return {
    ...c,
    channel: { id: ZALO.id, type: ZALO.type, displayName: ZALO.displayName },
    assignee: c.assignedUserId ? { id: c.assignedUserId, name: holder?.name ?? null } : null,
    lastMessagePreview: preview(said),
  };
}

/** A body of /v1/conversations as the API sends it: one conversation, or a page of them. */
export function u30Body(body: unknown, said: (id: string) => readonly Said[] | undefined): unknown {
  const one = (x: unknown) =>
    x && typeof x === 'object' && 'assignedUserId' in x && 'state' in x
      ? withU30(x as Row, said((x as Row).id))
      : x;
  if (
    body &&
    typeof body === 'object' &&
    'data' in body &&
    Array.isArray((body as { data: unknown[] }).data)
  )
    return { ...body, data: (body as { data: unknown[] }).data.map(one) };
  return one(body);
}
