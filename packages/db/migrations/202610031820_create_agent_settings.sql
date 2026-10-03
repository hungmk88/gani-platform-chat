-- rollback: compensating migration drops table public.agent_settings; only acceptable before real settings exist (N74).
-- agent_settings: the settings of one person as an agent inside one organisation (N74). One row per (org, user).
-- No deleted_at and no DELETE: settings are overwritten, never retired. No upper bound on the limit: the organisation decides.

CREATE TABLE public.agent_settings (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  max_concurrent_conversations integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_settings_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  -- The person must be a member of the same organisation.
  CONSTRAINT agent_settings_member_fk FOREIGN KEY (org_id, user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT agent_settings_org_id_user_id_key UNIQUE (org_id, user_id),
  CONSTRAINT agent_settings_max_concurrent_check CHECK (max_concurrent_conversations > 0)
);

ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_settings_app ON public.agent_settings FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

CREATE POLICY agent_settings_support ON public.agent_settings FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- No DELETE. The columns hold no secret, so support gets the whole table (N74).
GRANT SELECT, INSERT, UPDATE ON public.agent_settings TO app_role;
GRANT SELECT ON public.agent_settings TO support_role;
