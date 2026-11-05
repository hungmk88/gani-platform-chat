import type { LeadEventRow, LeadRow } from '@gani/db';

/** A lead as the API answers it (LeadSchema). The title is the agents' words: answered, never logged. */
export const leadView = (row: LeadRow) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  title: row.title,
  customer: { id: row.customerId, displayName: row.customerDisplayName },
  conversationId: row.conversationId,
  stage: { id: row.stageId, name: row.stageName },
  status: row.status,
  owner: row.ownerUserId === null ? null : { id: row.ownerUserId, name: row.ownerName },
  createdBy: row.createdBy,
  lostReason: row.lostReason,
  closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
  // Lead scoring is Đợt 2 (Brief F1 step 6).
  score: null,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** What happened to a lead (LeadEventSchema): codes, steps and ids only, never free words. */
export const leadEventView = (e: LeadEventRow) => ({
  type: e.type,
  fromStage: e.fromStage,
  toStage: e.toStage,
  outcome: e.outcome,
  actorUserId: e.actorUserId,
  occurredAt: e.occurredAt.toISOString(),
});
