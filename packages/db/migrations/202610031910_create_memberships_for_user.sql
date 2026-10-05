-- rollback: compensating migration drops app.memberships_for_user(uuid) and revokes USAGE on schema app from auth_role (N76).
-- app.memberships_for_user: which organisations a person belongs to, asked right after login when there is no tenant context yet
-- (spec RLS M01 §3.5). SECURITY DEFINER so it can read org_members, which auth_role may not touch; owner migration_role has BYPASSRLS.
-- It trusts p_user_id: the caller (the auth pool, PR6) must pass the id of an authenticated session, never a value from a request (N76).
-- Returns active AND suspended memberships so the caller can say "your account is suspended" instead of "you belong nowhere".
-- Pending invitations have no user yet, so they never match. Deleted memberships and deleted organisations are left out.

CREATE FUNCTION app.memberships_for_user(p_user_id uuid) RETURNS TABLE (org_id uuid, role text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT m.org_id, m.role, m.status
    FROM public.org_members m
    JOIN public.organizations o ON o.id = m.org_id
    WHERE m.user_id = p_user_id
      AND m.deleted_at IS NULL
      AND m.status IN ('active', 'suspended')
      AND o.deleted_at IS NULL
    ORDER BY m.org_id
  $$;

REVOKE ALL ON FUNCTION app.memberships_for_user(uuid) FROM PUBLIC;
-- USAGE on schema app is what lets auth_role call the function; EXECUTE on every other app function stays revoked.
GRANT USAGE ON SCHEMA app TO auth_role;
GRANT EXECUTE ON FUNCTION app.memberships_for_user(uuid) TO auth_role;
