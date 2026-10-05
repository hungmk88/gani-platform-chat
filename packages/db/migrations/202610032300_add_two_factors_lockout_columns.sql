-- rollback: compensating migration revokes UPDATE (failed_verification_count, locked_until) from auth_role and drops the CHECK and both columns; only acceptable before anyone enrolled in 2FA (N86).
-- The 2FA plugin of better-auth 1.7.7 counts wrong codes and locks an enrolment for a while (its accountLockout: 5 wrong codes, 30 minutes,
-- set in PR6c-3c): a 6 digit code has only a million values, so this is the wall against guessing it. The plugin READS and WRITES both
-- fields on every verification, and its Drizzle adapter fails when the table has no such column (found reading the schema of the plugin
-- and running a full enrolment and sign-in, PR6c-3). They are counters of an enrolment, not of a person: the lock of the account itself
-- (users.failed_login_count, users.locked_until) is a different thing and is not touched.

ALTER TABLE public.two_factors
  ADD COLUMN failed_verification_count integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz,
  ADD CONSTRAINT two_factors_failed_verification_count_check CHECK (failed_verification_count >= 0);

-- Added to the columns auth_role may UPDATE (secret, backup_codes, verified, updated_at); user_id and id still never change.
GRANT UPDATE (failed_verification_count, locked_until) ON public.two_factors TO auth_role;
