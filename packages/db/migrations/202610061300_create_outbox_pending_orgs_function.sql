-- rollback: compensating migration drops function app.outbox_pending_orgs(integer, integer); the relay then cannot find the organisations that have work (N97).
-- app.outbox_pending_orgs: which organisations have outbox work for the relay (outbox spec §4, N94, N97). The relay has to see every
-- organisation, but app_role is filtered by RLS and raises TN001 without a tenant, and no role of ours may bypass RLS. So this is a
-- FUNCTION, not a view: SECURITY DEFINER, it runs as its owner (migration_role, BYPASSRLS) and hands back nothing but organisation ids.
-- The relay then opens one TenantTx per id and reads the events through RLS as everyone else does. A view would have no definer
-- and app_role would be filtered out of it. Same pattern as app.memberships_for_user (N76); no fifth role.
-- Work = a pending event that is due, or a claimed one older than the lease (a relay died holding it). Deleted organisations are left out.
-- The bounds are checked, not trusted: p_limit 1..1000, p_lease_seconds >= 1 (22023).

CREATE FUNCTION app.outbox_pending_orgs(p_limit integer, p_lease_seconds integer DEFAULT 60) RETURNS TABLE (org_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 1000' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 THEN
    RAISE EXCEPTION 'p_lease_seconds must be at least 1' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT w.org
    FROM (
      SELECT e.org_id AS org, min(e.created_at) AS oldest
      FROM public.outbox_events e
      JOIN public.organizations o ON o.id = e.org_id AND o.deleted_at IS NULL
      WHERE (e.status = 'pending' AND e.available_at <= now())
         OR (e.status = 'claimed' AND e.claimed_at < now() - make_interval(secs => p_lease_seconds))
      GROUP BY e.org_id
    ) w
    ORDER BY w.oldest, w.org
    LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION app.outbox_pending_orgs(integer, integer) FROM PUBLIC;
-- Only the application role (the worker uses it) may run it: not auth_role, not support_role.
GRANT EXECUTE ON FUNCTION app.outbox_pending_orgs(integer, integer) TO app_role;
