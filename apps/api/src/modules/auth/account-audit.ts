import { auditOwnAccountEvent, withAuthUser, type AccountEvent, type createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';

/** Logs what a person did to their own account (N162); `userId` is the person of an authenticated session or of a spent token. */
export type AccountAudit = (userId: string, action: AccountEvent) => Promise<void>;

/**
 * One row of `action` in each organisation where `userId` is an active member (app.audit_own_account_event, ADR-004). The list is read
 * first with app.memberships_for_user; the function itself skips an organisation the person no longer belongs to, so a membership
 * that ends in between is never written to.
 */
export function accountAudit(pool: ReturnType<typeof createDbPool>): AccountAudit {
  return async (userId, action) => {
    const { rows } = await pool.query<{ org_id: string }>(
      `SELECT org_id FROM app.memberships_for_user($1) WHERE status = 'active'`,
      [userId],
    );
    await withAuthUser(pool, userId, (tx) =>
      auditOwnAccountEvent(tx, { action, orgIds: rows.map((r) => r.org_id), newId: uuidv7 }),
    );
  };
}
