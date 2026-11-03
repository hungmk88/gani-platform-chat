-- rollback: compensating migration drops function app.after_hours_held_orgs(integer); the after-hours release job then cannot find the organisations that hold conversations.
-- 19th SECURITY DEFINER function (ADR-004, N193; CEO approved the C10-4 plan 03/11/2026); it returns organisation ids only, no PII,
-- no secret; it waits for the adviser with the other 18 (#386).
-- app.after_hours_held_orgs: which organisations have a conversation held outside business hours (after_hours_hold, T03, Brief F6),
-- for the job that releases them when the workspace opens (T08, C10-4b). Same pattern as app.outbound_pending_orgs: app_role is
-- filtered by RLS and raises TN001 without a tenant, so this FUNCTION runs as its owner and hands back organisation ids only; the job
-- then reads and moves the conversations one organisation at a time, through RLS (packages/db after-hours-store.ts). Deleted
-- organisations are left out. conversations_after_hours_idx (202611091510) keeps the scan to the held rows. p_limit 1..1000 (22023).

CREATE FUNCTION app.after_hours_held_orgs(p_limit integer)
  RETURNS TABLE (org_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 1000' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT c.org_id
    FROM public.conversations c
    JOIN public.organizations o ON o.id = c.org_id AND o.deleted_at IS NULL
    WHERE c.after_hours_hold
    GROUP BY c.org_id
    ORDER BY c.org_id
    LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION app.after_hours_held_orgs(integer) FROM PUBLIC;
-- Only the application role (the worker uses it) may run it: not auth_role, not support_role.
GRANT EXECUTE ON FUNCTION app.after_hours_held_orgs(integer) TO app_role;
