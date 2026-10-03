-- rollback: compensating migration drops app.support_access_ok(); policies that call it must be dropped first.
-- Gate of support_role (spec RLS M01 §3.4): true while the caller has an unexpired access session for the current org.
-- SECURITY DEFINER so it can read platform_access_logs, which no application role may touch; owner migration_role has BYPASSRLS.
-- It must use session_user, not current_user: inside a SECURITY DEFINER function current_user is the owner, session_user is
-- the person who logged in. If app.current_org() raises TN001 (no tenant context) the error passes through unchanged.
-- STABLE, not IMMUTABLE: now() changes between statements.

CREATE FUNCTION app.support_access_ok() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.platform_access_logs
      WHERE db_login = session_user::text AND org_id = app.current_org() AND now() < expires_at
    )
  $$;

REVOKE ALL ON FUNCTION app.support_access_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.support_access_ok() TO support_role;
