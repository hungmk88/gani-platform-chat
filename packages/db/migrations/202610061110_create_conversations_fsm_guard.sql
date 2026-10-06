-- rollback: compensating migration drops trigger conversations_fsm_guard on public.conversations and function app.conversations_fsm_guard(); only acceptable before the state machine is relied upon (N96).
-- Only the ConversationStateMachine changes the columns it owns (CLAUDE.md rule 4, FSM spec §5). The state machine switches the
-- transaction-local setting app.fsm on around its UPDATE; any other UPDATE of those columns fails, whoever the role is (a backfill
-- by migration_role switches it on too and is logged by the runner). The setting is set by the application itself, so this stops
-- a mistake or a hand-written UPDATE, not someone who already runs code inside the process. INSERT is not guarded: the first state
-- is chosen by the state machine's create step and N75 keeps every INSERT naming it.
-- FS001: changed outside the state machine. FS002: version did not grow by exactly one (a forgotten or doubled bump).

CREATE FUNCTION app.conversations_fsm_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF ROW(NEW.state, NEW.version, NEW.assigned_user_id, NEW.after_hours_hold, NEW.closed_at, NEW.outcome)
     IS NOT DISTINCT FROM ROW(OLD.state, OLD.version, OLD.assigned_user_id, OLD.after_hours_hold, OLD.closed_at, OLD.outcome) THEN
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('app.fsm', true), '') <> 'on' THEN
    RAISE EXCEPTION 'conversation state columns can only be changed by the ConversationStateMachine'
      USING ERRCODE = 'FS001', HINT = 'use ConversationStateMachine.transition';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'conversation version must grow by exactly one'
      USING ERRCODE = 'FS002';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app.conversations_fsm_guard() FROM PUBLIC;

CREATE TRIGGER conversations_fsm_guard BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION app.conversations_fsm_guard();
