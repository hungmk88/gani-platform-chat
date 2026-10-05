-- rollback: compensating migration drops trigger users_status_transition_check and function public.users_status_transition_check(),
-- then revokes UPDATE (status, email_verified_at) on public.users from auth_role; the two columns must not stay grantable without it (N77, N78).
-- The only change of users.status that exists is pending_password -> active, the moment a person sets a password (spec RLS M01 §3.2, §3.7).
-- At that moment the trigger itself sets email_verified_at = now() (server time: whatever the caller sent is ignored) and clears
-- pending_password_since, so the CHECK users_pending_since_check holds without auth_role needing a grant on that column.
-- It applies to every role, migration_role included: an emergency fix is a migration that disables the trigger on purpose, with an audit.
-- The error is check_violation (23514) with a message that says what was refused. BEFORE UPDATE OF: it fires only when a statement
-- names status or email_verified_at, so other updates (failed_login_count, ...) never pay for it.

CREATE FUNCTION public.users_status_transition_check() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending_password' AND NEW.status = 'active' THEN
      NEW.email_verified_at := pg_catalog.now();
      NEW.pending_password_since := NULL;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'users.status may only change from pending_password to active (asked % -> %)', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at THEN
    RAISE EXCEPTION 'users.email_verified_at may only be set together with the change from pending_password to active'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER users_status_transition_check
  BEFORE UPDATE OF status, email_verified_at ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_status_transition_check();

-- Granted in the same migration as the trigger, so there is no moment where auth_role can set these columns freely.
GRANT UPDATE (status, email_verified_at) ON public.users TO auth_role;
