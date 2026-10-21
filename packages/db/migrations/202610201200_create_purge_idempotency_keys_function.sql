-- rollback: compensating migration drops function app.purge_idempotency_keys(integer, integer); old keys then stay (each is reset when its key is used again, N134).
-- Removes the Idempotency-Keys older than p_retention_hours, at most p_limit of them, for every organisation (N134). After 24 hours a
-- key gives nothing back any more (beginIdempotent resets it), so the row is only kept space. SECURITY DEFINER because it works across
-- tenants and app_role cannot DELETE (same pattern as app.purge_inbound_event_keys, N104). The bounds are checked, not trusted:
-- p_retention_hours >= 24, so a wrong call cannot erase an answer still owed to a request sent again, and p_limit 1..10000 (22023).
-- Returns how many it removed; the worker calls again until it gets 0.
CREATE FUNCTION app.purge_idempotency_keys(p_retention_hours integer, p_limit integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  removed integer;
BEGIN
  IF p_retention_hours IS NULL OR p_retention_hours < 24 THEN
    RAISE EXCEPTION 'p_retention_hours must be at least 24' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 10000' USING ERRCODE = '22023';
  END IF;
  WITH old AS (
    SELECT k.org_id, k.user_id, k.key
    FROM public.idempotency_keys k
    WHERE k.created_at < now() - make_interval(hours => p_retention_hours)
    ORDER BY k.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.idempotency_keys k
  USING old
  WHERE k.org_id = old.org_id AND k.user_id = old.user_id AND k.key = old.key;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$$;

REVOKE ALL ON FUNCTION app.purge_idempotency_keys(integer, integer) FROM PUBLIC;
-- Only the application role (the worker uses it): not auth_role, not support_role.
GRANT EXECUTE ON FUNCTION app.purge_idempotency_keys(integer, integer) TO app_role;
