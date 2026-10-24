import { eq, sql } from 'drizzle-orm';

import { agentSettings } from './schema/agent-settings.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

/**
 * Sets the own limit of conversations at once of the person `userId` in the transaction's organisation (C9, N156) and returns the one
 * before, or null when there was none. The caller locks the member first (lockMember), so two changes take turns. The row of
 * agent_settings is made the first time (`id`, a UUIDv7 of the caller), then only its limit changes: there is no DELETE.
 */
export async function setAgentCapacity(
  tx: TenantTx,
  q: { readonly id: string; readonly userId: string; readonly max: number },
): Promise<number | null> {
  const userId = assertUuid(q.userId, 'userId');
  const [before] = await tx
    .select({ max: agentSettings.maxConcurrentConversations })
    .from(agentSettings)
    .where(eq(agentSettings.userId, userId));
  if (before) {
    await tx
      .update(agentSettings)
      .set({ maxConcurrentConversations: q.max, updatedAt: sql`now()` })
      .where(eq(agentSettings.userId, userId));
    return before.max;
  }
  await tx.insert(agentSettings).values({
    id: assertUuid(q.id, 'id'),
    orgId: currentTenantContext().orgId,
    userId,
    maxConcurrentConversations: q.max,
  });
  return null;
}
