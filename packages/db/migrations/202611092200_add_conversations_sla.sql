-- rollback: compensating migration drops the columns sla_due_at, sla_paused_reason, sla_remaining_seconds of public.conversations (and their CHECKs); Conversation.sla is then null again.
-- The SLA of a conversation (E1 of brief 09; Q7 provisional values, CEO 07/11/2026, N208): when it is due, in working time, from the
-- moment it needs a person (HUMAN_WAITING_Q); paused while waiting for the customer or outside the hours, with what was left of it.
-- Written by the state machine in the transaction of each transition (E3); null while the bot handles it, and once it is closed.
-- Expand only: three nullable columns, no rewrite, no backfill (every existing conversation has no SLA, as before).
-- What was left is kept in whole seconds (0 when the SLA was already overdue as it paused: the old due time then stays, N208 item 4).

ALTER TABLE public.conversations
  ADD COLUMN sla_due_at timestamptz,
  ADD COLUMN sla_paused_reason text,
  ADD COLUMN sla_remaining_seconds integer,
  ADD CONSTRAINT conversations_sla_paused_reason_check
    CHECK (sla_paused_reason IS NULL OR sla_paused_reason IN ('waiting_customer', 'outside_hours')),
  ADD CONSTRAINT conversations_sla_remaining_check CHECK (sla_remaining_seconds IS NULL OR sla_remaining_seconds >= 0),
  -- A pause keeps what was left, and only a pause does; a paused SLA still has its due time to show.
  ADD CONSTRAINT conversations_sla_pause_check CHECK ((sla_paused_reason IS NULL) = (sla_remaining_seconds IS NULL)),
  ADD CONSTRAINT conversations_sla_due_check CHECK (sla_paused_reason IS NULL OR sla_due_at IS NOT NULL);

-- app_role updates conversations by a list of columns and support_role reads them by a list (202610201300); none is personal data.
GRANT UPDATE (sla_due_at, sla_paused_reason, sla_remaining_seconds) ON public.conversations TO app_role;
GRANT SELECT (sla_due_at, sla_paused_reason, sla_remaining_seconds) ON public.conversations TO support_role;
