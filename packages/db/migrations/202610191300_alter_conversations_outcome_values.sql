-- rollback: compensating migration drops conversations_outcome_check and adds back the one of 202610061100 (won, lost, resolved, resolved_by_bot).
-- N130 (decided 19/10/2026, option a): the outcome of a closed conversation follows Brief v1.0 P14: resolved, no_response or spam
-- when a person closes it, resolved_by_bot when the bot does (T04). Won and lost belong to the lead (POST /v1/leads/{id}/close), not
-- to the conversation: they are no longer accepted. conversation_events keeps the outcomes it recorded as they were (history).
-- No row is rewritten. The new CHECK is added NOT VALID, then validated at once when no row holds won or lost: true of production,
-- CI and any new database (no conversation has been closed by a person yet). A development database that still has such rows from
-- earlier test runs keeps the constraint unvalidated (new rows are checked) and says so in a notice.

ALTER TABLE public.conversations DROP CONSTRAINT conversations_outcome_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_outcome_check CHECK (
    outcome IS NULL OR outcome IN ('resolved', 'no_response', 'spam', 'resolved_by_bot')
  ) NOT VALID;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversations WHERE outcome IN ('won', 'lost')) THEN
    RAISE NOTICE 'conversations_outcome_check left NOT VALID: rows with outcome won or lost exist (test data of an older version)';
  ELSE
    ALTER TABLE public.conversations VALIDATE CONSTRAINT conversations_outcome_check;
  END IF;
END
$$;
