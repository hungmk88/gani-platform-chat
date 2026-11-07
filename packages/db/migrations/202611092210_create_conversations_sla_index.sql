-- rollback: compensating migration drops index conversations_sla_due_idx CONCURRENTLY; the filter ?sla=due_soon|overdue then scans the conversations of the workspaces.
-- migrate:no-transaction
-- The filter of the Inbox by SLA (?sla=due_soon|overdue, E3): the conversations of the workspaces of the session by due time. Partial:
-- only a conversation that needs a person has a due time, while most rows are closed or with the bot (sla null), so the index stays
-- small. Built CONCURRENTLY (review DB-03): conversations is written by every message.
CREATE INDEX CONCURRENTLY conversations_sla_due_idx
  ON public.conversations (org_id, workspace_id, sla_due_at) WHERE sla_due_at IS NOT NULL;
