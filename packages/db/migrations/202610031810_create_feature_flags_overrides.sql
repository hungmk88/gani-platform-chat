-- rollback: compensating migration drops table public.feature_flags_overrides; only acceptable before real overrides exist (N74).
-- feature_flags_overrides: switches a global flag on or off for one organisation, or for one workspace of it (N74).
-- workspace_id NULL means the whole organisation. RLS by org_id only, like workspaces. No deleted_at and no DELETE:
-- an override is turned off with enabled = false, so the row stays as the record of the decision.

CREATE TABLE public.feature_flags_overrides (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid,
  flag_key text NOT NULL,
  enabled boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_flags_overrides_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  -- Default MATCH SIMPLE: not checked when workspace_id IS NULL, which is exactly an organisation-wide override.
  CONSTRAINT feature_flags_overrides_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT feature_flags_overrides_flag_fk FOREIGN KEY (flag_key) REFERENCES public.feature_flags_global (key) ON DELETE RESTRICT,
  -- NULLS NOT DISTINCT: at most one organisation-wide override per flag, not one per NULL.
  CONSTRAINT feature_flags_overrides_scope_key UNIQUE NULLS NOT DISTINCT (org_id, workspace_id, flag_key)
);

ALTER TABLE public.feature_flags_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags_overrides FORCE ROW LEVEL SECURITY;

CREATE POLICY feature_flags_overrides_app ON public.feature_flags_overrides FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

CREATE POLICY feature_flags_overrides_support ON public.feature_flags_overrides FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- No DELETE (see above). The columns hold no secret, so support gets the whole table (N74).
GRANT SELECT, INSERT, UPDATE ON public.feature_flags_overrides TO app_role;
GRANT SELECT ON public.feature_flags_overrides TO support_role;
