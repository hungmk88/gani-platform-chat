-- rollback: compensating migration drops function app.outbox_stats(); the worker then reports outbox_stats_up 0 and no outbox gauges (N118).
-- app.outbox_stats: the state of the outbox for the monitoring (outbox spec §7, review E-01, N118). The numbers are for the whole
-- platform, so they cross every organisation; app_role is filtered by RLS and raises TN001 without a tenant. So, as for
-- app.outbox_pending_orgs, a SECURITY DEFINER function owned by migration_role (BYPASSRLS) that hands back three numbers and nothing
-- else: no id, no organisation, no payload. Deleted organisations are left out, as the relay leaves them out (their events never go).
-- The age is from created_at: how long the oldest event that has not gone has waited, backoff included (alert > 30 s, urgent > 120 s).

CREATE FUNCTION app.outbox_stats()
  RETURNS TABLE (pending bigint, oldest_pending_age_seconds double precision, dead_letter bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT count(*) FILTER (WHERE e.status = 'pending'),
           coalesce(extract(epoch FROM now() - min(e.created_at) FILTER (WHERE e.status = 'pending')), 0)::double precision,
           count(*) FILTER (WHERE e.status = 'dead_letter')
    FROM public.outbox_events e
    JOIN public.organizations o ON o.id = e.org_id AND o.deleted_at IS NULL
    WHERE e.status IN ('pending', 'dead_letter')
  $$;

REVOKE ALL ON FUNCTION app.outbox_stats() FROM PUBLIC;
-- Only the application role (the worker uses it) may run it: not auth_role, not support_role.
GRANT EXECUTE ON FUNCTION app.outbox_stats() TO app_role;
