-- rollback: compensating migration drops table public.sessions; only acceptable before real sign-ins exist (N77).
-- sessions: one row per sign-in (spec RLS M01 §3.1-3.2, ADR-003). Global table, no org_id and no RLS: access is GRANT by column alone,
-- and only auth_role gets any. A session is revoked with revoked_at, never deleted (SessionCleanupJob removes old rows as migration_role).
-- Lifetime: at most 12 hours and never extended, so expires_at is fixed at insert (auth_role cannot UPDATE it) and a CHECK caps it.
-- active_org_id is the organisation the person acts in; changing it means a new session (N77). No ip_address and no user_agent:
-- they are personal data and nothing needs them yet. "token" may hold a hash instead of the raw token: decided in PR6c (N77).

CREATE TABLE public.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  active_org_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE RESTRICT,
  -- Default MATCH SIMPLE: not checked while active_org_id IS NULL. Otherwise the person must be a member of that organisation.
  CONSTRAINT sessions_active_org_fk FOREIGN KEY (active_org_id, user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT sessions_token_key UNIQUE (token),
  CONSTRAINT sessions_token_check CHECK (btrim(token) <> ''),
  CONSTRAINT sessions_lifetime_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '12 hours')
);

CREATE INDEX sessions_user_id_idx ON public.sessions (user_id);

-- No DELETE. UPDATE is revoked_at and updated_at only: nothing else about a session may change after sign-in.
GRANT SELECT, INSERT ON public.sessions TO auth_role;
GRANT UPDATE (revoked_at, updated_at) ON public.sessions TO auth_role;
