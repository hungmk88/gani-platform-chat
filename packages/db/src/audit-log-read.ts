import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';

import type { Page } from './conversation-read.js';
import { cursorString, decodeCursor, encodeCursor } from './cursor.js';
import { auditLogs } from './schema/audit-logs.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

/** The most rows one read gives (GET /v1/audit-logs, A9a). */
export const AUDIT_LOG_MAX_LIMIT = 100;

// Newest first, `id` breaking ties. The key as text with microseconds: a JavaScript Date would round it to milliseconds and the next
// page could repeat or skip a row (as member-directory.ts).
const SORT_TEXT = sql<string>`to_char(${auditLogs.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const SORT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TARGET_TYPE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * What GET /v1/audit-logs filters by (Brief P9: "lọc ngày, người, hành động"). The organisation is never one of them: it is the tenant
 * transaction's (rule 1), and RLS keeps every other one out.
 */
export interface AuditLogQuery {
  readonly actorUserId?: string;
  readonly action?: string;
  /** `member`, `workspace`, `team`… (A9b). */
  readonly targetType?: string;
  /** From this instant, included. */
  readonly from?: Date;
  /** Up to this instant, left out. */
  readonly to?: Date;
  /** 1..AUDIT_LOG_MAX_LIMIT. */
  readonly limit: number;
  /** The `nextCursor` of the page before, read with the same filters (A9b). */
  readonly cursor?: string;
}

export interface AuditLogEntry {
  readonly id: string;
  /** Null: the system acted. */
  readonly actorUserId: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  /** Ids and numbers, and the reason an Owner or Admin typed (member.two_factor_reset, N155): for their screen, never a log. */
  readonly detail: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/**
 * The audit log of the transaction's organisation, newest first (`id` breaking ties), filtered, `limit` rows a page. A wrong filter
 * throws before any query; a cursor this API did not give throws InvalidCursorError.
 */
export async function listAuditLogs(
  tx: TenantTx,
  query: AuditLogQuery,
): Promise<Page<AuditLogEntry>> {
  const { actorUserId, action, targetType, from, to, limit } = query;
  if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_LOG_MAX_LIMIT) {
    throw new RangeError(`limit must be a whole number between 1 and ${AUDIT_LOG_MAX_LIMIT}`);
  }
  if (action?.trim() === '') throw new RangeError('action must not be empty');
  if (targetType !== undefined && !TARGET_TYPE.test(targetType)) {
    throw new RangeError('targetType must be a word of lower case letters');
  }
  if (from && Number.isNaN(from.getTime())) throw new RangeError('from must be a valid time');
  if (to && Number.isNaN(to.getTime())) throw new RangeError('to must be a valid time');
  if (from && to && from >= to) throw new RangeError('from must be before to');
  const actor = actorUserId === undefined ? undefined : assertUuid(actorUserId, 'actorUserId');
  const fields = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  const after = fields && {
    at: cursorString(fields, 'at', SORT_FORMAT),
    id: cursorString(fields, 'id', UUID_FORMAT),
  };
  // The organisation again, on top of RLS: it lets the planner use the (org_id, created_at) index of each partition.
  const where: SQL[] = [eq(auditLogs.orgId, currentTenantContext().orgId)];
  if (actor !== undefined) where.push(eq(auditLogs.actorUserId, actor));
  if (action !== undefined) where.push(eq(auditLogs.action, action));
  if (targetType !== undefined) where.push(eq(auditLogs.targetType, targetType));
  if (after) {
    where.push(
      sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`,
    );
  }
  if (from) where.push(gte(auditLogs.createdAt, from));
  if (to) where.push(lt(auditLogs.createdAt, to));
  const rows = await tx
    .select({
      id: auditLogs.id,
      actorUserId: auditLogs.actorUserId,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      detail: auditLogs.detail,
      createdAt: auditLogs.createdAt,
      sortKey: SORT_TEXT,
    })
    .from(auditLogs)
    .where(and(...where))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page.map(({ sortKey, ...row }) => {
      void sortKey;
      return { ...row, detail: row.detail as Record<string, unknown> };
    }),
    nextCursor:
      rows.length > limit && last ? encodeCursor({ at: last.sortKey, id: last.id }) : null,
  };
}
