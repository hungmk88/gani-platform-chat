-- rollback: compensating migration drops function app.purge_inbound_event_keys(integer, integer) and table public.inbound_event_keys; only acceptable before real inbound events exist, because without the keys a webhook sent again would be stored twice (N104).
-- inbound_event_keys: the key that stops a webhook sent again from becoming a second event (I1). It cannot be a unique key of
-- inbound_events, which is partitioned by month (see 202610071210). The webhook writes the key in the same transaction as the event with
-- INSERT ... ON CONFLICT DO NOTHING: no row inserted means a duplicate, and the event is not written. Not partitioned, small, and it
-- has an org_id and RLS by organisation: the keys of one tenant are not readable by another.
-- app_role has no DELETE on any table with RLS, so old keys are removed by app.purge_inbound_event_keys. The key must outlive the
-- payload (30 days) because the key is what stops duplicates; the worker calls the function with 35 days. The function refuses less than
-- 30, so a wrong call cannot erase the keys that protect from duplicates.

CREATE TABLE public.inbound_event_keys (
  org_id uuid NOT NULL,
  channel_account_id uuid NOT NULL,
  platform_message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_event_keys_pkey PRIMARY KEY (channel_account_id, platform_message_id),
  CONSTRAINT inbound_event_keys_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT inbound_event_keys_channel_account_fk FOREIGN KEY (org_id, channel_account_id)
    REFERENCES public.channel_accounts (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT inbound_event_keys_message_id_check CHECK (btrim(platform_message_id) <> '')
);

-- What the purge scans.
CREATE INDEX inbound_event_keys_created_idx ON public.inbound_event_keys (created_at);

ALTER TABLE public.inbound_event_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_event_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY inbound_event_keys_app ON public.inbound_event_keys FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

CREATE POLICY inbound_event_keys_support ON public.inbound_event_keys FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- A key is never changed or deleted by the application (old ones go through the function below).
GRANT SELECT, INSERT ON public.inbound_event_keys TO app_role;
GRANT SELECT ON public.inbound_event_keys TO support_role;

-- Removes the keys older than p_retention_days, at most p_limit of them, for every organisation. SECURITY DEFINER because it works
-- across tenants and app_role cannot DELETE (same pattern as app.outbox_pending_orgs, N94). The bounds are checked, not trusted:
-- p_retention_days >= 30 and p_limit 1..10000 (22023). Returns how many it removed; the worker calls again until it gets 0.
CREATE FUNCTION app.purge_inbound_event_keys(p_retention_days integer, p_limit integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  removed integer;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 30 THEN
    RAISE EXCEPTION 'p_retention_days must be at least 30' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 10000' USING ERRCODE = '22023';
  END IF;
  WITH old AS (
    SELECT k.channel_account_id, k.platform_message_id
    FROM public.inbound_event_keys k
    WHERE k.created_at < now() - make_interval(days => p_retention_days)
    ORDER BY k.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.inbound_event_keys k
  USING old
  WHERE k.channel_account_id = old.channel_account_id AND k.platform_message_id = old.platform_message_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$$;

REVOKE ALL ON FUNCTION app.purge_inbound_event_keys(integer, integer) FROM PUBLIC;
-- Only the application role (the worker uses it): not auth_role, not support_role.
GRANT EXECUTE ON FUNCTION app.purge_inbound_event_keys(integer, integer) TO app_role;
