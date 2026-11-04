import { and, desc, eq, lt, sql } from 'drizzle-orm';

import type { Page } from './conversation-read.js';
import { cursorString, decodeCursor, encodeCursor } from './cursor.js';
import { conversationNotes } from './schema/conversation-notes.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The internal notes of a conversation (C6, N194; CEO 04/11/2026). Row-level security keeps them to who sees the conversation
// (app.conversation_visible); who may write one on it (its holder, or an Owner, Admin or Manager) is the caller's check. A note never
// changes and is never deleted in Đợt 1. Its body is the agents' free words: never logged, never in an audit row.

export type NoteKind = 'note' | 'transfer_reason';

export interface NoteRow {
  readonly id: string;
  readonly conversationId: string;
  readonly kind: NoteKind;
  readonly authorUserId: string;
  /** Through app.org_users (active members, no email): null for an author who left or has no name. */
  readonly authorName: string | null;
  readonly body: string;
  readonly createdAt: Date;
}

/** At most this many notes a page (P9). */
export const NOTE_PAGE_MAX = 100;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const n = conversationNotes;
const columns = {
  id: n.id,
  conversationId: n.conversationId,
  kind: n.kind,
  authorUserId: n.authorUserId,
  authorName: sql<
    string | null
  >`(SELECT nullif(btrim(u.display_name), '') FROM app.org_users u WHERE u.user_id = ${n.authorUserId})`,
  body: n.body,
  createdAt: n.createdAt,
};

/** Writes a note on `conversationId` (trimmed, NFC); the database refuses a blank or too long body (23514). */
export async function addConversationNote(
  tx: TenantTx,
  note: {
    readonly id: string;
    readonly conversationId: string;
    readonly kind: NoteKind;
    readonly authorUserId: string;
    readonly body: string;
  },
): Promise<NoteRow> {
  const id = assertUuid(note.id, 'id');
  await tx.insert(n).values({
    id,
    orgId: currentTenantContext().orgId,
    conversationId: assertUuid(note.conversationId, 'conversationId'),
    kind: note.kind,
    authorUserId: assertUuid(note.authorUserId, 'authorUserId'),
    body: note.body.trim().normalize('NFC'),
  });
  const [row] = await tx.select(columns).from(n).where(eq(n.id, id));
  return row as NoteRow;
}

/** The notes of `conversationId`, newest first, a page at a time; the cursor names the last note of the page before. */
export async function listConversationNotes(
  tx: TenantTx,
  conversationId: string,
  q: { readonly cursor?: string; readonly limit: number },
): Promise<Page<NoteRow>> {
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > NOTE_PAGE_MAX)
    throw new RangeError(`limit must be 1..${NOTE_PAGE_MAX}`);
  const where = [eq(n.conversationId, assertUuid(conversationId, 'conversationId'))];
  if (q.cursor !== undefined)
    where.push(lt(n.id, cursorString(decodeCursor(q.cursor), 'id', UUID_FORMAT)));
  const rows = await tx
    .select(columns)
    .from(n)
    .where(and(...where))
    .orderBy(desc(n.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit) as NoteRow[];
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor: rows.length > q.limit && last ? encodeCursor({ id: last.id }) : null,
  };
}
