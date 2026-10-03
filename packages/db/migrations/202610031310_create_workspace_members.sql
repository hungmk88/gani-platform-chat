-- rollback: compensating migration drops table public.workspace_members; only acceptable before real memberships exist (rows are soft deleted, never removed).
-- workspace_members: who works in which workspace (spec RLS M01 §4.5). workspace_role is left out until N11 is decided.

CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_members_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT workspace_members_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT workspace_members_org_id_workspace_id_user_id_key UNIQUE (org_id, workspace_id, user_id),
  CONSTRAINT workspace_members_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  -- A person in a workspace must be a member of the same org. Pending invitations have user_id NULL,
  -- so they can never be the target of this key (org_members_pending_user_check, N63).
  CONSTRAINT workspace_members_user_fk FOREIGN KEY (org_id, user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_members_created_by_fk FOREIGN KEY (org_id, created_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX workspace_members_org_user_idx ON public.workspace_members (org_id, user_id);
CREATE INDEX workspace_members_org_workspace_idx ON public.workspace_members (org_id, workspace_id);

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_members_app ON public.workspace_members FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

-- No DELETE (soft delete). The support_role policy comes with app.support_access_ok() in PR4 (N57).
GRANT SELECT, INSERT, UPDATE ON public.workspace_members TO app_role;
