-- rollback: compensating migration drops table public.org_members; only acceptable before real memberships exist (rows are soft deleted, never removed).
-- org_members: links a user to an organisation and doubles as the invitation (spec RLS M01 §4.3, N6).
-- A pending invitation has no user yet (user_id IS NULL); accepting it sets user_id and status together.

CREATE TABLE public.org_members (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  user_id uuid,
  invited_email text,
  role text NOT NULL,
  status text NOT NULL,
  invite_token_hash bytea,
  invite_expires_at timestamptz,
  invited_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_members_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT org_members_user_fk FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE RESTRICT,
  -- Target of the composite foreign keys of other tables, so a member can only be referenced inside its own org.
  CONSTRAINT org_members_org_id_id_key UNIQUE (org_id, id),
  -- Not partial: it is a foreign key target. NULL user_id (pending invitations) may repeat.
  CONSTRAINT org_members_org_id_user_id_key UNIQUE (org_id, user_id),
  CONSTRAINT org_members_invited_by_fk FOREIGN KEY (org_id, invited_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT org_members_role_check CHECK (role IN ('owner', 'admin', 'manager', 'sales', 'support', 'marketing', 'viewer')),
  CONSTRAINT org_members_status_check CHECK (status IN ('pending', 'active', 'suspended')),
  CONSTRAINT org_members_pending_check CHECK (
    status <> 'pending' OR (invite_token_hash IS NOT NULL AND invite_expires_at IS NOT NULL AND invited_email IS NOT NULL)
  ),
  -- pending <=> no user yet. Without this a pending row with a user_id could be the target of a
  -- workspace_members foreign key, i.e. a person who has not accepted could enter a workspace.
  CONSTRAINT org_members_pending_user_check CHECK ((status = 'pending') = (user_id IS NULL)),
  CONSTRAINT org_members_invited_email_normalized CHECK (invited_email IS NULL OR invited_email = lower(btrim(invited_email))),
  CONSTRAINT org_members_token_hash_length CHECK (invite_token_hash IS NULL OR octet_length(invite_token_hash) = 32)
);

CREATE UNIQUE INDEX org_members_invite_token_hash_key ON public.org_members (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;
CREATE UNIQUE INDEX org_members_pending_email_key ON public.org_members (org_id, invited_email)
  WHERE status = 'pending';

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members FORCE ROW LEVEL SECURITY;

CREATE POLICY org_members_app ON public.org_members FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

-- No DELETE (soft delete). The support_role policy comes with app.support_access_ok() in PR4 (N57).
GRANT SELECT, INSERT, UPDATE ON public.org_members TO app_role;
