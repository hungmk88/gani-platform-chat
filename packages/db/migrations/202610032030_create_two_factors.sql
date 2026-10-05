-- rollback: compensating migration drops table public.two_factors; only acceptable before anyone enrolled in 2FA (N77).
-- two_factors: the TOTP enrolment of a person (ADR-003: required for Owner, Admin and platform_operator). One row per person.
-- secret and backup_codes are secrets: whether Better Auth stores them encrypted or hashed is checked in PR6c (N77).
-- Global table, no RLS: GRANT to auth_role only, no DELETE (PendingUserCleanupJob runs as migration_role).

CREATE TABLE public.two_factors (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT two_factors_user_fk FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE RESTRICT,
  CONSTRAINT two_factors_user_id_key UNIQUE (user_id),
  CONSTRAINT two_factors_secret_check CHECK (btrim(secret) <> '')
);

-- UPDATE: a new secret or a used backup code. The owner of the row never changes.
GRANT SELECT, INSERT ON public.two_factors TO auth_role;
GRANT UPDATE (secret, backup_codes, updated_at) ON public.two_factors TO auth_role;
