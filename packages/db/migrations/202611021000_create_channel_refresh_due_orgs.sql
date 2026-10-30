-- rollback: compensating migration drops function app.channel_refresh_due_orgs(integer, integer, integer); the token refresh job then cannot find the organisations that have work.
-- 17th SECURITY DEFINER function; N35/Rủi ro 4 chưa chốt; hàm chỉ trả org_id, không PII, không secret; nếu cố vấn yêu cầu giảm số hàm, hàm này sẽ được rework.
-- app.channel_refresh_due_orgs: which organisations have a channel account whose tokens the refresh job must renew (zalo-channel spec
-- §4, B2, N173). Same pattern as app.outbox_pending_orgs (N94): app_role is filtered by RLS and raises TN001 without a tenant, so this
-- FUNCTION runs as its owner and hands back organisation ids only; the job then claims the accounts one organisation at a time,
-- through RLS (claimChannelRefresh of @gani/db).
-- Due = a live Zalo OA account, connected or token_expiring, that has a refresh token and an access token expiring within
-- p_before_seconds (no expiry: not due), and is not claimed, or was claimed longer than p_lease_seconds ago (a job died holding it).
-- claimChannelRefresh (packages/db/src/channel-refresh-store.ts) writes the same test: change both together. Deleted organisations are
-- left out. The bounds are checked, not trusted: p_limit 1..1000, p_before_seconds >= 0, p_lease_seconds >= 1 (22023).

CREATE FUNCTION app.channel_refresh_due_orgs(p_limit integer, p_before_seconds integer, p_lease_seconds integer)
  RETURNS TABLE (org_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 1000' USING ERRCODE = '22023';
  END IF;
  IF p_before_seconds IS NULL OR p_before_seconds < 0 THEN
    RAISE EXCEPTION 'p_before_seconds must be at least 0' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 THEN
    RAISE EXCEPTION 'p_lease_seconds must be at least 1' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT w.org
    FROM (
      SELECT a.org_id AS org, min(a.access_token_expires_at) AS soonest
      FROM public.channel_accounts a
      JOIN public.organizations o ON o.id = a.org_id AND o.deleted_at IS NULL
      WHERE a.type = 'zalo_oa' AND a.deleted_at IS NULL AND a.status IN ('connected', 'token_expiring')
        AND a.refresh_token_enc IS NOT NULL
        AND a.access_token_expires_at < now() + make_interval(secs => p_before_seconds)
        AND (a.refresh_claimed_at IS NULL OR a.refresh_claimed_at < now() - make_interval(secs => p_lease_seconds))
      GROUP BY a.org_id
    ) w
    ORDER BY w.soonest, w.org
    LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION app.channel_refresh_due_orgs(integer, integer, integer) FROM PUBLIC;
-- Only the application role (the worker uses it) may run it: not auth_role, not support_role.
GRANT EXECUTE ON FUNCTION app.channel_refresh_due_orgs(integer, integer, integer) TO app_role;
