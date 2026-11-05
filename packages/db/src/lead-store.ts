import { and, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';

import type { Page } from './conversation-read.js';
import { cursorString, decodeCursor, encodeCursor } from './cursor.js';
import { LeadAccessDeniedError, leadReadScope, type LeadViewer } from './lead-access.js';
import { leads } from './schema/leads.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// Reading the leads of a workspace (L3a-1; G1–G3, N188, N196, N200; CEO 05/11/2026). Row-level security keeps them to the organisation
// and the workspaces of the transaction; lead-access.ts narrows them to who may see them, here, on every read, so the API never writes
// that rule itself. One lead with its events, making a lead and reading the pipeline come in L3a-2, moving and closing one in L3b. The
// title is the agents' free words: never logged, and no lead_events row carries it.

export const LEAD_STATUSES = ['open', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** The most leads one read gives (GET /v1/leads). */
export const LEAD_MAX_LIMIT = 100;

export interface LeadRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly customerId: string;
  /** null until someone knows the customer's name. */
  readonly customerDisplayName: string | null;
  readonly conversationId: string | null;
  readonly stageId: string;
  readonly stageName: string;
  readonly status: LeadStatus;
  readonly ownerUserId: string | null;
  /** Through app.org_users: null for an owner who gave no name or is no longer an active member. */
  readonly ownerName: string | null;
  readonly createdBy: string;
  readonly lostReason: string | null;
  readonly closedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const l = leads;
const leadColumns = {
  id: l.id,
  workspaceId: l.workspaceId,
  title: l.title,
  customerId: l.customerId,
  customerDisplayName: sql<
    string | null
  >`(SELECT c.display_name FROM public.customers c WHERE c.org_id = ${l.orgId} AND c.id = ${l.customerId})`,
  conversationId: l.conversationId,
  stageId: l.stageId,
  stageName: sql<string>`(SELECT s.name FROM public.pipeline_stages s WHERE s.org_id = ${l.orgId} AND s.id = ${l.stageId})`,
  status: l.status,
  ownerUserId: l.ownerUserId,
  ownerName: sql<
    string | null
  >`(SELECT nullif(btrim(u.display_name), '') FROM app.org_users u WHERE u.user_id = ${l.ownerUserId})`,
  createdBy: l.createdBy,
  lostReason: l.lostReason,
  closedAt: l.closedAt,
  version: l.version,
  createdAt: l.createdAt,
  updatedAt: l.updatedAt,
};

/** Throws LeadAccessDeniedError for Support; the scope of everyone else. */
function scopeOf(viewer: LeadViewer): 'workspace' | 'own' {
  const scope = leadReadScope(viewer.role);
  if (scope === 'none') throw new LeadAccessDeniedError();
  return scope;
}

/** The narrowing of a scope: a Sales reads the leads they made or own. */
function scopeWhere(viewer: LeadViewer): SQL | undefined {
  if (scopeOf(viewer) === 'workspace') return undefined;
  const me = assertUuid(viewer.userId, 'userId');
  return or(eq(l.createdBy, me), eq(l.ownerUserId, me));
}

// The key as text with microseconds, as ticket-read.ts: a Date would round it and a page could repeat or skip a lead.
const SORT_TEXT = sql<string>`to_char(${l.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const SORT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface LeadQuery {
  /** One of the transaction's workspaces; absent: all of them. */
  readonly workspaceId?: string;
  readonly stageId?: string;
  readonly status?: LeadStatus;
  /** `none` (nobody follows it), or the id of a member (the API turns `me` into the caller's id). */
  readonly owner?: string;
  /** The id of a member (the API turns `me` into the caller's id). */
  readonly createdBy?: string;
  readonly customerId?: string;
  /** 1..LEAD_MAX_LIMIT. */
  readonly limit: number;
  /** The `nextCursor` of the page before, read with the same filters. */
  readonly cursor?: string;
}

/**
 * A page of the leads the viewer sees, newest first (`id` breaking ties): every filter, the viewer's scope and the cursor are one WHERE.
 * Support throws LeadAccessDeniedError; a wrong filter throws before any query; a foreign cursor InvalidCursorError.
 */
export async function listLeads(
  tx: TenantTx,
  viewer: LeadViewer,
  q: LeadQuery,
): Promise<Page<LeadRow>> {
  const scope = scopeWhere(viewer);
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > LEAD_MAX_LIMIT)
    throw new RangeError(`limit must be a whole number between 1 and ${LEAD_MAX_LIMIT}`);
  if (q.status !== undefined && !(LEAD_STATUSES as readonly string[]).includes(q.status))
    throw new RangeError('status is not one of a lead');
  const where: (SQL | undefined)[] = [scope];
  if (q.workspaceId !== undefined)
    where.push(eq(l.workspaceId, assertUuid(q.workspaceId, 'workspaceId')));
  if (q.stageId !== undefined) where.push(eq(l.stageId, assertUuid(q.stageId, 'stageId')));
  if (q.status !== undefined) where.push(eq(l.status, q.status));
  if (q.owner === 'none') where.push(isNull(l.ownerUserId));
  else if (q.owner !== undefined) where.push(eq(l.ownerUserId, assertUuid(q.owner, 'owner')));
  if (q.createdBy !== undefined) where.push(eq(l.createdBy, assertUuid(q.createdBy, 'createdBy')));
  if (q.customerId !== undefined)
    where.push(eq(l.customerId, assertUuid(q.customerId, 'customerId')));
  if (q.cursor !== undefined) {
    const fields = decodeCursor(q.cursor);
    const at = cursorString(fields, 'at', SORT_FORMAT);
    const id = cursorString(fields, 'id', UUID_FORMAT);
    where.push(sql`(${l.createdAt}, ${l.id}) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = await tx
    .select({ ...leadColumns, sortKey: SORT_TEXT })
    .from(l)
    .where(and(...where))
    .orderBy(desc(l.createdAt), desc(l.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    rows: page.map(({ sortKey, ...row }) => {
      void sortKey;
      return row;
    }),
    nextCursor:
      rows.length > q.limit && last ? encodeCursor({ at: last.sortKey, id: last.id }) : null,
  };
}
