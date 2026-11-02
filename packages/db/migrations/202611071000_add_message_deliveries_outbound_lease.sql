-- rollback: compensating migration drops function app.outbound_pending_orgs(integer, integer), index message_deliveries_due_idx and the columns next_attempt_at and claimed_at of public.message_deliveries (with their CHECK); the outbound worker then cannot claim deliveries (O1, N185).
-- The lease and the backoff of the outbound worker (O1, N185; A 02/11/2026; zalo-channel-spec §5): a delivery stays pending until the
-- platform answers; the worker claims it (claimed_at, a lease it takes back when a worker died holding it), sends outside the
-- transaction, and writes sent, a later attempt (next_attempt_at, the backoff of the relay) or failed after the last attempt. No new
-- status: a claimed delivery is still pending, so the CHECKs of 202610211000 stay as they are. Expand only: next_attempt_at has a
-- non-volatile default (evaluated once, no rewrite) and claimed_at is nullable; the table is small, so the index is built in the
-- transaction.

ALTER TABLE public.message_deliveries
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN claimed_at timestamptz,
  -- Only a pending delivery is ever claimed: sent and failed are final.
  ADD CONSTRAINT message_deliveries_claimed_check CHECK (claimed_at IS NULL OR status = 'pending');

-- The work of a workspace: its pending deliveries in the order they come due.
CREATE INDEX message_deliveries_due_idx ON public.message_deliveries (org_id, workspace_id, next_attempt_at)
  WHERE status = 'pending';

-- The worker writes the lease and the next attempt; the columns it already updates are granted in 202610211000.
GRANT UPDATE (next_attempt_at, claimed_at) ON public.message_deliveries TO app_role;

-- app.outbound_pending_orgs: which organisations have deliveries to send, for the worker that polls message_deliveries. Same reason and
-- same pattern as app.inbound_pending_orgs (N104): the worker must see every organisation, app_role is filtered by RLS and raises
-- TN001 without a tenant, and no role of ours bypasses RLS. SECURITY DEFINER, it runs as its owner and hands back organisation ids
-- only; the worker then reads the deliveries through RLS in one TenantTx per organisation and workspace.
-- Work = a pending delivery that is due and not claimed, or one claimed longer ago than the lease (a worker died holding it).
-- Organisations come oldest work first. Deleted organisations are left out. Bounds are checked: p_limit 1..1000, p_lease_seconds >= 1.
CREATE FUNCTION app.outbound_pending_orgs(p_limit integer, p_lease_seconds integer DEFAULT 60) RETURNS TABLE (org_id uuid)
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
      SELECT d.org_id AS org, min(d.next_attempt_at) AS oldest
      FROM public.message_deliveries d
      JOIN public.organizations o ON o.id = d.org_id AND o.deleted_at IS NULL
      WHERE d.status = 'pending'
        AND ((d.claimed_at IS NULL AND d.next_attempt_at <= now())
          OR d.claimed_at < now() - make_interval(secs => p_lease_seconds))
      GROUP BY d.org_id
    ) w
    ORDER BY w.oldest, w.org
    LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION app.outbound_pending_orgs(integer, integer) FROM PUBLIC;
-- Only the application role (the worker uses it): not auth_role, not support_role.
GRANT EXECUTE ON FUNCTION app.outbound_pending_orgs(integer, integer) TO app_role;
