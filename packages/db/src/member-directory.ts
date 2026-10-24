import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { boolean, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { cursorString, decodeCursor, encodeCursor } from './cursor.js';
import type { Page } from './conversation-read.js';
import type { OrgRole } from './schema/org-members.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The list of the screen of members (#19, N153): app.org_member_directory (migration 202610221100), the members of the transaction's
// organisation with their email. The view itself filters by app.current_org(); who may read it (an Owner or an Admin, N12) is the
// caller's check, as for every permission of the API.

const directory = pgSchema('app')
  .view('org_member_directory', {
    id: uuid('id').notNull(),
    userId: uuid('user_id'),
    email: text('email'),
    displayName: text('display_name'),
    role: text('role').notNull(),
    status: text('status').notNull(),
    twoFactorEnabled: boolean('two_factor_enabled').notNull(),
    inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  })
  .existing();

export interface MemberEntry {
  readonly id: string;
  /** Null for an invitation nobody has taken yet. */
  readonly userId: string | null;
  /** PII: for the screen of an Owner or an Admin, never a log. The invited email while the invitation is pending. */
  readonly email: string | null;
  readonly displayName: string | null;
  readonly role: OrgRole;
  readonly status: 'active' | 'suspended' | 'pending';
  readonly twoFactorEnabled: boolean;
  readonly inviteExpiresAt: Date | null;
  readonly createdAt: Date;
}

// Oldest first, `id` breaking ties. The key as text with microseconds: a JavaScript Date would round it to milliseconds and the next
// page could repeat a row.
const SORT_TEXT = sql<string>`to_char(${directory.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const SORT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const columns = {
  id: directory.id,
  userId: directory.userId,
  email: directory.email,
  displayName: directory.displayName,
  role: directory.role,
  status: directory.status,
  twoFactorEnabled: directory.twoFactorEnabled,
  inviteExpiresAt: directory.inviteExpiresAt,
  createdAt: directory.createdAt,
};

/** One row of the directory, or null when the organisation of the transaction has no such member (or it is deleted). */
export async function loadMember(tx: TenantTx, id: string): Promise<MemberEntry | null> {
  const [row] = await tx
    .select(columns)
    .from(directory)
    .where(eq(directory.id, assertUuid(id, 'id')));
  return (row as MemberEntry | undefined) ?? null;
}

/** The members and pending invitations of the organisation, `limit` (1..100) at a time; `cursor` is the `nextCursor` of a page. */
export async function listMembers(
  tx: TenantTx,
  q: { readonly cursor?: string; readonly limit: number },
): Promise<Page<MemberEntry>> {
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 100)
    throw new RangeError('limit must be 1..100');
  const where: SQL[] = [];
  if (q.cursor !== undefined) {
    const fields = decodeCursor(q.cursor);
    const at = cursorString(fields, 'at', SORT_FORMAT);
    const id = cursorString(fields, 'id', UUID_FORMAT);
    where.push(sql`(${directory.createdAt}, ${directory.id}) > (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = await tx
    .select({ ...columns, sortKey: SORT_TEXT })
    .from(directory)
    .where(and(...where))
    .orderBy(asc(directory.createdAt), asc(directory.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    // The CHECKs of org_members hold role and status to these values.
    rows: page.map(({ sortKey, ...row }) => {
      void sortKey;
      return row as MemberEntry;
    }),
    nextCursor:
      rows.length > q.limit && last ? encodeCursor({ at: last.sortKey, id: last.id }) : null,
  };
}
