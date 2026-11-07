-- rollback: compensating migration drops function app.sla_running_orgs(integer); the SLA job of the opening hours then cannot find the organisations whose SLA clock it moves.
-- 21st SECURITY DEFINER function (ADR-004, N211; CEO chose the scheduled job, option (i), 07/11/2026); it returns organisation ids
-- only, no PII, no secret; it waits for the adviser with the other 20 (#386).
-- app.sla_running_orgs: which organisations have a conversation whose SLA clock the opening hours move (E4b): one running (it pauses
-- `outside_hours` when its workspace closes) or one paused `outside_hours` (it runs again when the workspace opens). A pause
-- `waiting_customer` is the customer's, not the hours', so it is left out. Same pattern as app.after_hours_held_orgs: app_role is
-- filtered by RLS and raises TN001 without a tenant, so this FUNCTION runs as its owner and hands back organisation ids only; the job
-- then reads and moves the conversations one organisation at a time, through RLS. Deleted organisations are left out.
-- conversations_sla_due_idx (202611092210) keeps the scan to the rows with an SLA. p_limit 1..1000 (22023).

CREATE FUNCTION app.sla_running_orgs(p_limit integer)
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
    WHERE c.sla_due_at IS NOT NULL AND (c.sla_paused_reason IS NULL OR c.sla_paused_reason = 'outside_hours')
    GROUP BY c.org_id
    ORDER BY c.org_id
    LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION app.sla_running_orgs(integer) FROM PUBLIC;
-- Only the application role (the worker uses it) may run it: not auth_role, not support_role.
GRANT EXECUTE ON FUNCTION app.sla_running_orgs(integer) TO app_role;
