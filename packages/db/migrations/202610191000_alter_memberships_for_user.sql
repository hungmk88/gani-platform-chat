-- rollback: compensating migration re-creates app.memberships_for_user(uuid) with the body of 202610031910 (without the join on users);
-- the grants are kept by CREATE OR REPLACE and need no change.
-- Review DB-01 (docs/reviews/H-full-codebase-audit.md): a person whose users row is soft-deleted (deleted_at set) kept every membership,
-- so the tenant middleware still found an organisation for them. A deleted person now belongs to no organisation, whatever the state of
-- their org_members rows. Same signature, same SECURITY DEFINER and search_path, so callers (AuthService, /switch-org, the 2FA rule) and
-- the grants do not change.

CREATE OR REPLACE FUNCTION app.memberships_for_user(p_user_id uuid) RETURNS TABLE (org_id uuid, role text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT m.org_id, m.role, m.status
    FROM public.org_members m
    JOIN public.organizations o ON o.id = m.org_id
    JOIN public.users u ON u.id = m.user_id
    WHERE m.user_id = p_user_id
      AND m.deleted_at IS NULL
      AND m.status IN ('active', 'suspended')
      AND o.deleted_at IS NULL
      AND u.deleted_at IS NULL
    ORDER BY m.org_id
  $$;

REVOKE ALL ON FUNCTION app.memberships_for_user(uuid) FROM PUBLIC;
