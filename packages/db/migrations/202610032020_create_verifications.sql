-- rollback: compensating migration drops table public.verifications; only acceptable before real magic links exist (N77).
-- verifications: one-time tokens such as the magic link that sets a password (spec RLS M01 §3.7). value must hold the SHA-256 hash of
-- the token, never the token (what Better Auth really writes here is checked in PR6c, N77). used_at marks a token as spent.
-- Global table, no RLS: GRANT to auth_role only, no DELETE (expired rows are cleaned by a job running as migration_role).

CREATE TABLE public.verifications (
  id uuid PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verifications_identifier_check CHECK (btrim(identifier) <> ''),
  CONSTRAINT verifications_value_check CHECK (btrim(value) <> ''),
  CONSTRAINT verifications_expires_check CHECK (expires_at > created_at)
);

CREATE INDEX verifications_identifier_idx ON public.verifications (identifier);
CREATE INDEX verifications_expires_at_idx ON public.verifications (expires_at);

-- UPDATE: mark as used, or reissue (value, expires_at). identifier never changes.
GRANT SELECT, INSERT ON public.verifications TO auth_role;
GRANT UPDATE (value, expires_at, used_at, updated_at) ON public.verifications TO auth_role;
