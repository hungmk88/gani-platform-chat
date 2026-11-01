-- rollback: compensating migration drops the column priority of public.conversations (and its CHECK); the queue then has no priority.
-- The priority of a conversation that waits for a person (U78, N184; A 01/11/2026): set when the bot hands over, from the priority of
-- the handoff node, and read later by the queue, the SLA and the routing (C8, I3). The reason of a handoff goes to the history
-- (conversation_events.detail), not here. Expand only: a NOT NULL column with a constant default, which PostgreSQL adds without
-- rewriting the table (the check of the constraint reads the rows once, all of them 'normal'), so this takes only a short lock.

ALTER TABLE public.conversations
  ADD COLUMN priority text NOT NULL DEFAULT 'normal',
  ADD CONSTRAINT conversations_priority_check CHECK (priority IN ('normal', 'high', 'urgent'));

-- app_role updates conversations by a list of columns and support_role reads them by a list (202610201300).
GRANT UPDATE (priority) ON public.conversations TO app_role;
GRANT SELECT (priority) ON public.conversations TO support_role;
