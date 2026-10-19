-- rollback: compensating migration drops index conversations_inbox_keyset_idx CONCURRENTLY; listConversations then sorts without it.
-- migrate:no-transaction
-- The order of the Inbox (listConversations, Brief P9 cursor pagination): most recent activity first, a conversation with no message
-- yet counted from its creation, id as the tie-breaker so a page boundary never drops or repeats a row. conversations_inbox_idx of
-- 202610061100 has no id and sorts a NULL last_message_at first, so it cannot serve the keyset. Built CONCURRENTLY (review DB-03):
-- conversations is written by every message.
CREATE INDEX CONCURRENTLY conversations_inbox_keyset_idx
  ON public.conversations (org_id, workspace_id, (coalesce(last_message_at, created_at)) DESC, id DESC);
