-- rollback: compensating migration drops table public.organizations; only acceptable before real tenant data exists (rows are never deleted, only soft deleted).
-- organizations: RLS by its own id (spec RLS M01 §4.1). id is the tenant key, there is no org_id column.

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_slug_key UNIQUE (slug)
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;

-- Explicit casts, no reliance on implicit ones. A missing context raises TN001 (app.current_org()).
CREATE POLICY organizations_app ON public.organizations FOR ALL TO app_role
  USING (id = (SELECT app.current_org())::uuid)
  WITH CHECK (id = (SELECT app.current_org())::uuid);

-- No DELETE for anyone (soft delete). The support_role policy arrives with app.support_access_ok() in PR4:
-- until then FORCE RLS without a policy denies support_role everything (fail-closed), so it gets no grant.
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE ON public.organizations TO app_role;
