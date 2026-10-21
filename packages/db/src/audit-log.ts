import { auditLogs } from './schema/audit-logs.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

/**
 * One row of the organisation's audit log, in the caller's transaction (it commits with what it records, or not at all). `detail`
 * holds ids and numbers, never PII (the migration and review say so). The organisation is the tenant transaction's.
 */
export async function insertAuditLog(
  tx: TenantTx,
  row: {
    readonly id: string;
    readonly actorUserId: string | null;
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly detail: Readonly<Record<string, string | number | null>>;
  },
): Promise<void> {
  await tx.insert(auditLogs).values({
    id: assertUuid(row.id, 'id'),
    orgId: currentTenantContext().orgId,
    actorUserId: row.actorUserId === null ? null : assertUuid(row.actorUserId, 'actorUserId'),
    action: row.action,
    targetType: row.targetType,
    targetId: assertUuid(row.targetId, 'targetId'),
    detail: row.detail,
  });
}
