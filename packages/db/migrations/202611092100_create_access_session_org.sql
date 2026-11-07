-- rollback: compensating migration drops function app.access_session_org(uuid, uuid), then the constraints and columns ended_at, end_reason of public.platform_access_logs; only acceptable before any session is ended.
-- The end of an access session (U79 item 3, N207 B3) and the check the tenant middleware makes on every request that carries one
-- (U79 item 2, N207 B2). Expand only: the two columns are NULL on every existing row, which is what "not ended" means.
-- app.access_session_org is the 20th SECURITY DEFINER function (ADR-004): the middleware runs as auth_role before any tenant context,
-- and no application role may read platform_access_logs (N69), so a function owned by migration_role (BYPASSRLS) answers the one
-- question it needs. It gives the organisation of the session, or NULL; never the reason, the login or anything else. NULL when the
-- session is not the caller's, has run out, was ended, or the caller is not a platform operator: the middleware answers each the same
-- (403 access_session_expired), so the answer tells no one which it was. Only auth_role may call it.

ALTER TABLE public.platform_access_logs ADD COLUMN ended_at timestamptz, ADD COLUMN end_reason text;
ALTER TABLE public.platform_access_logs
  ADD CONSTRAINT platform_access_logs_end_check CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  ADD CONSTRAINT platform_access_logs_end_reason_check CHECK (end_reason IS NULL OR end_reason IN ('manual', 'expired'));

CREATE FUNCTION app.access_session_org(p_session uuid, p_operator uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT l.org_id
    FROM public.platform_access_logs l
    JOIN public.users u ON u.id = l.operator_user_id
    WHERE l.id = p_session
      AND l.operator_user_id = p_operator
      AND now() < l.expires_at
      AND l.ended_at IS NULL
      AND u.is_platform_operator
  $$;

REVOKE ALL ON FUNCTION app.access_session_org(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.access_session_org(uuid, uuid) TO auth_role;
