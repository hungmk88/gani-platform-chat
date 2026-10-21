-- rollback: compensating migration drops index conversations_contact_idx CONCURRENTLY; findConversationForContact then scans the conversations of the account.
-- migrate:no-transaction
-- The lookup of a person's conversation by the inbound processor (findConversationForContact, inbound spec §3): the open one, else the
-- latest closed one (T14 within 72 hours). conversations_open_per_user_key only holds the open ones. Built CONCURRENTLY (review DB-03).
CREATE INDEX CONCURRENTLY conversations_contact_idx
  ON public.conversations (channel_account_id, external_user_id, closed_at DESC)
  WHERE channel_account_id IS NOT NULL;
