-- rollback: compensating migration drops table public.team_members; only acceptable before real memberships exist (rows are soft deleted, never removed).
-- team_members: who belongs to which team (spec RLS M01 §4.7). No workspace_id of its own: a team may be company-wide,
-- and the spec asks only that the person is a member of the org.

CREATE TABLE public.team_members (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_members_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT team_members_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT team_members_org_id_team_id_user_id_key UNIQUE (org_id, team_id, user_id),
  CONSTRAINT team_members_team_fk FOREIGN KEY (org_id, team_id)
    REFERENCES public.teams (org_id, id) ON DELETE RESTRICT,
  -- user_id is NOT NULL and pending invitations have user_id NULL, so they can never be the target (N63).
  CONSTRAINT team_members_user_fk FOREIGN KEY (org_id, user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT team_members_created_by_fk FOREIGN KEY (org_id, created_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX team_members_org_user_idx ON public.team_members (org_id, user_id);
CREATE INDEX team_members_org_team_idx ON public.team_members (org_id, team_id);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members FORCE ROW LEVEL SECURITY;

CREATE POLICY team_members_app ON public.team_members FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

-- No DELETE (soft delete). The support_role policy comes with app.support_access_ok() in PR4 (N57).
GRANT SELECT, INSERT, UPDATE ON public.team_members TO app_role;
