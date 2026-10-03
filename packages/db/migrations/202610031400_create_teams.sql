-- rollback: compensating migration drops table public.teams; only acceptable before real teams exist (rows are soft deleted, never removed).
-- teams: groups of people inside an organisation (spec RLS M01 §4.6). workspace_id is NULL for a company-wide team
-- (N14). RLS by org_id only, so a company-wide team is visible whatever workspaces the session holds.

CREATE TABLE public.teams (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid,
  name text NOT NULL,
  slug text NOT NULL,
  created_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT teams_org_id_id_key UNIQUE (org_id, id),
  -- NULLS NOT DISTINCT (PostgreSQL 15+): two company-wide teams cannot share a slug. Soft deleted rows count too.
  CONSTRAINT teams_org_id_workspace_id_slug_key UNIQUE NULLS NOT DISTINCT (org_id, workspace_id, slug),
  -- Default MATCH SIMPLE: not checked when workspace_id IS NULL, which is exactly a company-wide team.
  CONSTRAINT teams_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT teams_created_by_fk FOREIGN KEY (org_id, created_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT teams_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 2 AND 63),
  CONSTRAINT teams_name_check CHECK (btrim(name) <> '')
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams FORCE ROW LEVEL SECURITY;

CREATE POLICY teams_app ON public.teams FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

-- No DELETE (soft delete). The support_role policy comes with app.support_access_ok() in PR4 (N57).
GRANT SELECT, INSERT, UPDATE ON public.teams TO app_role;
