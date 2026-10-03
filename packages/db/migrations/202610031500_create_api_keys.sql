-- rollback: compensating migration drops table public.api_keys and function public.api_key_scopes_valid; only acceptable before real keys exist (rows are soft deleted, never removed).
-- api_keys: keys for the public API (spec RLS M01 §4.8). Only the SHA-256 hash is stored, never the key.
-- workspace_id is NULL for a company-wide key. Looking a key up by prefix before a tenant context exists
-- needs a narrow SECURITY DEFINER function in a later PR (N8); app_role cannot do it under RLS.

-- Every scope is 8-32 characters. A CHECK cannot hold a subquery, so the rule lives in a function.
CREATE FUNCTION public.api_key_scopes_valid(scopes text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT
  AS $$ SELECT coalesce(bool_and(char_length(s) BETWEEN 8 AND 32), false) FROM unnest(scopes) AS s $$;

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash bytea NOT NULL,
  scopes text[] NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_keys_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT api_keys_org_id_id_key UNIQUE (org_id, id),
  -- Global on purpose (Brief P8): the prefix is how a request finds its key before any tenant is known.
  CONSTRAINT api_keys_key_prefix_key UNIQUE (key_prefix),
  CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash),
  -- Default MATCH SIMPLE: not checked when workspace_id IS NULL (a company-wide key).
  CONSTRAINT api_keys_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT api_keys_created_by_fk FOREIGN KEY (org_id, created_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT api_keys_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT api_keys_key_prefix_format CHECK (key_prefix ~ '^gk_[a-z0-9]{8}$'),
  CONSTRAINT api_keys_key_hash_length CHECK (octet_length(key_hash) = 32),
  CONSTRAINT api_keys_scopes_not_empty CHECK (cardinality(scopes) >= 1),
  CONSTRAINT api_keys_scopes_no_null CHECK (array_position(scopes, NULL) IS NULL),
  CONSTRAINT api_keys_scopes_length CHECK (public.api_key_scopes_valid(scopes))
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY api_keys_app ON public.api_keys FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

-- No DELETE (soft delete). UPDATE by column: org_id, key_prefix and key_hash never change after creation.
-- Rotating a key means creating a new one and revoking the old one. The support_role policy comes in PR4 (N57).
GRANT SELECT, INSERT ON public.api_keys TO app_role;
GRANT UPDATE (name, scopes, last_used_at, revoked_at, expires_at, deleted_at, updated_at)
  ON public.api_keys TO app_role;
