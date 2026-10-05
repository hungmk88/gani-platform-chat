-- rollback: compensating migration drops table public.accounts; only acceptable before real accounts exist (N77).
-- accounts: how a person signs in. Only the "credential" provider exists (email + password), so there are no OAuth token columns.
-- password holds an Argon2id hash, never a password: the CHECK refuses anything else, so a wrong hasher fails loudly (ADR-003).
-- Global table, no RLS: GRANT to auth_role only, no DELETE (PendingUserCleanupJob runs as migration_role).

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  password text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_user_fk FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE RESTRICT,
  CONSTRAINT accounts_provider_check CHECK (provider_id = 'credential'),
  CONSTRAINT accounts_password_check CHECK (password LIKE '$argon2id$%'),
  CONSTRAINT accounts_provider_account_key UNIQUE (provider_id, account_id),
  -- One password per person.
  CONSTRAINT accounts_user_provider_key UNIQUE (user_id, provider_id)
);

-- UPDATE is the password (a change of password) and updated_at; who the account belongs to never changes (N77).
GRANT SELECT, INSERT ON public.accounts TO auth_role;
GRANT UPDATE (password, updated_at) ON public.accounts TO auth_role;
