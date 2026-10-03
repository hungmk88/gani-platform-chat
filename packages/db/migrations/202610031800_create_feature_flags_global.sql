-- rollback: compensating migration drops table public.feature_flags_global; only acceptable before any override references a flag (RESTRICT).
-- feature_flags_global: the catalogue of feature flags, one row per flag for the whole platform (N74). Global table, no org_id and
-- no RLS, access is controlled by GRANT alone. A flag is temporary by design: owner and remove_by are required so it cannot be forgotten.

CREATE TABLE public.feature_flags_global (
  key text PRIMARY KEY,
  description text NOT NULL,
  owner text NOT NULL,
  remove_by date NOT NULL,
  default_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Lower snake case, starts with a letter: the key is used in code and in config, never as a free-form label.
  CONSTRAINT feature_flags_global_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$' AND char_length(key) BETWEEN 3 AND 64),
  CONSTRAINT feature_flags_global_description_check CHECK (btrim(description) <> ''),
  CONSTRAINT feature_flags_global_owner_check CHECK (btrim(owner) <> '')
);

-- Read only for the application and for support: no tenant data here, so support needs no access-session (N74).
-- Flags are created and changed by migration_role only.
GRANT SELECT ON public.feature_flags_global TO app_role, support_role;
