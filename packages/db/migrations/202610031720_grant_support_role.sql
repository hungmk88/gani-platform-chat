-- rollback: compensating migration drops the nine *_support policies and revokes the grants of support_role (N57).
-- support_role may only SELECT, and only while app.support_access_ok() holds for the current org (spec RLS M01 §3.4, §4).
-- Column-level SELECT where a column is a secret: invite_token_hash, invite_expires_at (org_members) and key_hash (api_keys).
-- Those lists name every allowed column, so a column added later stays hidden until a migration shows it. org_id is granted
-- on purpose even though RLS does not need the right to read it. invited_email stays visible: debugging invitations needs it,
-- and access is gated by a reasoned, 60 minute, logged session (N71). Partition children get no privilege (spec §6).

GRANT SELECT ON public.organizations, public.workspaces, public.workspace_members, public.teams, public.team_members,
  public.audit_logs, public.platform_access_logs TO support_role;
GRANT SELECT (id, org_id, user_id, invited_email, role, status, invited_by, deleted_at, created_at, updated_at)
  ON public.org_members TO support_role;
GRANT SELECT (id, org_id, workspace_id, name, key_prefix, scopes, last_used_at, revoked_at, expires_at, created_by, deleted_at, created_at, updated_at)
  ON public.api_keys TO support_role;

CREATE POLICY organizations_support ON public.organizations FOR SELECT TO support_role
  USING (id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

CREATE POLICY org_members_support ON public.org_members FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

CREATE POLICY workspaces_support ON public.workspaces FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

CREATE POLICY workspace_members_support ON public.workspace_members FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

CREATE POLICY teams_support ON public.teams FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

CREATE POLICY team_members_support ON public.team_members FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

CREATE POLICY api_keys_support ON public.api_keys FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

CREATE POLICY audit_logs_support ON public.audit_logs FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

CREATE POLICY platform_access_logs_support ON public.platform_access_logs FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- The two partitioned tables: existing partitions get the new policy too.
SELECT app.copy_policies_to_partitions('public.audit_logs');
SELECT app.copy_policies_to_partitions('public.platform_access_logs');
