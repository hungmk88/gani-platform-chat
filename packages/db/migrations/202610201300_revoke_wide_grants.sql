-- rollback: compensating migration grants UPDATE on the nine tables and SELECT on public.conversations to support_role again, and re-creates app.support_access_ok() without the created_at bound (review H DB-05, I DBM-01, DBM-06).
-- Least privilege for app_role and support_role (review H DB-05, review I DBM-01, DBM-02, DBM-06).
-- 1. app_role could UPDATE every column of nine tables, the identity of a row included. It keeps UPDATE on what a row's life changes,
--    never on what says which row it is (id, org_id), what it belongs to (workspace_id, user_id, team_id, flag_key, the channel and
--    the customer of a conversation) or who made it and when (created_by, created_at). org_members.user_id stays out: an invitation is
--    accepted through app.accept_invite (spec RLS M01 §3.7), not by an UPDATE of app_role. The other tables already grant by column.
-- 2. support_role read every column of conversations, so external_user_id (the Zalo id of the customer, added by 202610071310) with
--    them. It now reads a named list, as in 202610031720: a column added later stays hidden until a migration shows it.
-- 3. app.support_access_ok() scanned every partition of platform_access_logs on each query of support. A session lasts at most 60
--    minutes (CHECK platform_access_logs_expiry_check), so the bound on created_at changes no answer and lets the planner skip the
--    other months.

REVOKE UPDATE ON public.organizations, public.org_members, public.workspaces, public.workspace_members, public.teams,
  public.team_members, public.feature_flags_overrides, public.agent_settings, public.conversations FROM app_role;

GRANT UPDATE (slug, name, deleted_at, updated_at) ON public.organizations TO app_role;
GRANT UPDATE (role, status, invited_email, invite_token_hash, invite_expires_at, deleted_at, updated_at)
  ON public.org_members TO app_role;
GRANT UPDATE (slug, name, template, timezone, default_max_concurrent, deleted_at, updated_at) ON public.workspaces TO app_role;
GRANT UPDATE (deleted_at, updated_at) ON public.workspace_members TO app_role;
GRANT UPDATE (name, slug, deleted_at, updated_at) ON public.teams TO app_role;
GRANT UPDATE (deleted_at, updated_at) ON public.team_members TO app_role;
GRANT UPDATE (enabled, updated_at) ON public.feature_flags_overrides TO app_role;
GRANT UPDATE (max_concurrent_conversations, updated_at) ON public.agent_settings TO app_role;
GRANT UPDATE (state, version, assigned_user_id, after_hours_hold, closed_at, outcome, last_message_at, last_customer_message_at,
  updated_at) ON public.conversations TO app_role;

REVOKE SELECT ON public.conversations FROM support_role;
GRANT SELECT (id, org_id, workspace_id, state, version, assigned_user_id, after_hours_hold, closed_at, outcome, last_message_at,
  channel_account_id, last_customer_message_at, created_at, updated_at) ON public.conversations TO support_role;

CREATE OR REPLACE FUNCTION app.support_access_ok() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.platform_access_logs
      WHERE db_login = session_user::text AND org_id = app.current_org() AND now() < expires_at
        AND created_at > now() - interval '60 minutes'
    )
  $$;
