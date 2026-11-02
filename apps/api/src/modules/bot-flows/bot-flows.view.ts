import type { Simulation } from '@gani/bot-runtime';
import { CONVERSATION_PRIORITIES, type BotFlowRow, type BotFlowVersionRow } from '@gani/db';

/** A flow as the API answers it (BotFlowSchema). */
export const botFlowView = (row: BotFlowRow, publishedVersion: number | null) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  status: row.status,
  version: row.version,
  publishedVersion,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** A draft or published version with its graph (BotFlowVersionSchema); a discarded one is never answered. */
export const botFlowVersionView = (row: BotFlowVersionRow) => ({
  id: row.id,
  status: row.status as 'draft' | 'published',
  version: row.version,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  graph: row.graph,
});

/** A dry-run as the API answers it (BotDryRunResultSchema): a handover's priority as the bot would set it (normal unless known). */
export const botDryRunView = (
  flowId: string,
  version: { id: string; kind: 'draft' | 'published'; number: number | null },
  triggerMatched: boolean,
  sim: Simulation,
) => ({
  flowId,
  version,
  triggerMatched,
  businessHoursAssumed: true as const,
  status: sim.status,
  error: sim.error ?? null,
  turns: sim.turns.map((t) => ({
    replies: t.replies,
    steps: t.steps,
    handoff: t.handoff
      ? {
          reason: t.handoff.reason,
          priority: CONVERSATION_PRIORITIES.find((p) => p === t.handoff?.priority) ?? 'normal',
        }
      : null,
  })),
  vars: sim.vars,
  unusedMessages: sim.unusedMessages,
});
