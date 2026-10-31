import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';

import { auditLogs } from './schema/audit-logs.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

/** The most rows one read gives (GET /v1/audit-logs, A9a). */
export const AUDIT_LOG_MAX_LIMIT = 100;

/**
 * What GET /v1/audit-logs filters by (Brief P9: "lọc ngày, người, hành động"). The organisation is never one of them: it is the tenant
 * transaction's (rule 1), and RLS keeps every other one out.
 */
export interface AuditLogQuery {
  readonly actorUserId?: string;
  readonly action?: string;
  /** From this instant, included. */
  readonly from?: Date;
  /** Up to this instant, left out. */
  readonly to?: Date;
  /** 1..AUDIT_LOG_MAX_LIMIT. */
  readonly limit: number;
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

/** The audit log of the transaction's organisation, newest first (`id` breaking ties), filtered. A wrong filter throws before any query. */
export async function listAuditLogs(tx: TenantTx, query: AuditLogQuery): Promise<AuditLogEntry[]> {
  const { actorUserId, action, from, to, limit } = query;
  if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_LOG_MAX_LIMIT) {
    throw new RangeError(`limit must be a whole number between 1 and ${AUDIT_LOG_MAX_LIMIT}`);
  }
  if (action?.trim() === '') throw new RangeError('action must not be empty');
  if (from && Number.isNaN(from.getTime())) throw new RangeError('from must be a valid time');
  if (to && Number.isNaN(to.getTime())) throw new RangeError('to must be a valid time');
  if (from && to && from >= to) throw new RangeError('from must be before to');
  const actor = actorUserId === undefined ? undefined : assertUuid(actorUserId, 'actorUserId');
  // The organisation again, on top of RLS: it lets the planner use the (org_id, created_at) index of each partition.
  const where: SQL[] = [eq(auditLogs.orgId, currentTenantContext().orgId)];
  if (actor !== undefined) where.push(eq(auditLogs.actorUserId, actor));
  if (action !== undefined) where.push(eq(auditLogs.action, action));
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
    })
    .from(auditLogs)
    .where(and(...where))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit);
  return rows.map((row) => ({ ...row, detail: row.detail as Record<string, unknown> }));
}
