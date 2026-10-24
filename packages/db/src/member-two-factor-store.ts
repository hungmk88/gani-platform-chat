import { sql } from 'drizzle-orm';

import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

/** What `app.reset_member_two_factor` did; `shared`: the person is also in another organisation, or a platform operator. */
export type TwoFactorReset = 'reset' | 'not_found' | 'shared';

/**
 * Turns off the second factor of the member `id` of the transaction's organisation and ends every session of theirs (Q-U20-1, N155),
 * through app.reset_member_two_factor (SECURITY DEFINER, ADR-004). Who may do it is the caller's check.
 */
export async function resetMemberTwoFactor(tx: TenantTx, id: string): Promise<TwoFactorReset> {
  const rows = await tx.execute<{ result: TwoFactorReset }>(
    sql`SELECT app.reset_member_two_factor(${assertUuid(id, 'id')}::uuid) AS result`,
  );
  // The function returns one of these three, never NULL.
  return (rows.rows[0] as { result: TwoFactorReset }).result;
}
