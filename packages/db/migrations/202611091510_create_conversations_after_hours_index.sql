-- rollback: compensating migration drops index conversations_after_hours_idx CONCURRENTLY; app.after_hours_held_orgs and the release job then scan conversations.
-- migrate:no-transaction
-- The conversations held outside business hours (after_hours_hold, C10-4b): app.after_hours_held_orgs finds their organisations and
-- the release job their workspaces and ids, every minute. Partial, so it holds only the few held rows. Built CONCURRENTLY (review
-- DB-03): conversations is written by every message.
CREATE INDEX CONCURRENTLY conversations_after_hours_idx
  ON public.conversations (org_id, workspace_id, id) WHERE after_hours_hold;
