-- rollback: compensating migration drops trigger users_deleted_revoke_sessions on public.users and function
-- app.users_deleted_revoke_sessions(); sessions revoked by it stay revoked.
-- Review DB-01: soft-deleting a person (users.deleted_at from NULL to a time) ends every live session of theirs in the same transaction,
-- the way Better Auth ends one (revoked_at, never DELETE: ADR-003). Whoever deletes, and however (a migration_role script today, an admin
-- endpoint later), cannot forget it. Only migration_role may write deleted_at, so the trigger runs with its rights; INVOKER on purpose.
-- AFTER UPDATE OF deleted_at: it fires only when a statement names that column, and does nothing on a restore (time back to NULL) or a
-- second delete (already set).

CREATE FUNCTION app.users_deleted_revoke_sessions() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.sessions SET revoked_at = now(), updated_at = now()
    WHERE user_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION app.users_deleted_revoke_sessions() FROM PUBLIC;

CREATE TRIGGER users_deleted_revoke_sessions
  AFTER UPDATE OF deleted_at ON public.users
  FOR EACH ROW EXECUTE FUNCTION app.users_deleted_revoke_sessions();
