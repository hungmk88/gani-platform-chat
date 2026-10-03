-- rollback: compensating migration drops table public.workspaces; only acceptable before real workspaces exist (rows are soft deleted, never removed).
-- workspaces: the second tenant level inside an organisation (spec RLS M01 §4.4). RLS by org_id only, on purpose:
-- people need to list every workspace of their org to choose one.

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  template text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  default_max_concurrent integer NOT NULL DEFAULT 5,
  created_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  -- Target of the composite foreign keys of every child table (spec §1).
  CONSTRAINT workspaces_org_id_id_key UNIQUE (org_id, id),
  -- Unique over soft deleted rows too: a retired slug is never reused, so an old URL cannot point to another workspace (N62).
  CONSTRAINT workspaces_org_id_slug_key UNIQUE (org_id, slug),
  CONSTRAINT workspaces_created_by_fk FOREIGN KEY (org_id, created_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspaces_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 2 AND 63),
  CONSTRAINT workspaces_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT workspaces_template_check CHECK (template IN ('b2b_sales', 'b2c_order', 'service')),
  CONSTRAINT workspaces_max_concurrent_check CHECK (default_max_concurrent > 0)
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces FORCE ROW LEVEL SECURITY;

CREATE POLICY workspaces_app ON public.workspaces FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

-- No DELETE (soft delete). The support_role policy comes with app.support_access_ok() in PR4 (N57).
GRANT SELECT, INSERT, UPDATE ON public.workspaces TO app_role;
