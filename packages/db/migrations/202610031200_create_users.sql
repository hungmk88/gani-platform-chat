-- rollback: compensating migration drops table public.users; only acceptable before real accounts exist (rows are soft deleted, never removed).
-- users: global table, no org_id and no RLS (spec RLS M01 §4.2, Brief P8). Access is controlled by GRANT alone.

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  display_name text,
  locale text,
  status text NOT NULL,
  pending_password_since timestamptz,
  email_verified_at timestamptz,
  is_platform_operator boolean NOT NULL DEFAULT false,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Unique over soft deleted rows too, so a deleted account's email cannot be registered again.
  CONSTRAINT users_email_key UNIQUE (email),
  -- Stored normalised: lower case, no surrounding spaces. Comparisons never need lower().
  CONSTRAINT users_email_normalized CHECK (email <> '' AND email = lower(btrim(email))),
  CONSTRAINT users_status_check CHECK (status IN ('pending_password', 'active')),
  CONSTRAINT users_pending_since_check CHECK ((status = 'pending_password') = (pending_password_since IS NOT NULL))
);

-- Deliberately no GRANT. app_role must never read this table: a global table without RLS would show every
-- tenant's people to every tenant (spec §3.3, N3); names reach the app only through the app.org_users view
-- (PR5). The column grants of auth_role arrive with the auth tables (PR6).
