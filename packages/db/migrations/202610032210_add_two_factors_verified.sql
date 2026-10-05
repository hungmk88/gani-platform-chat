-- rollback: compensating migration revokes UPDATE (verified) from auth_role and drops the column; only acceptable before anyone enrolled in 2FA (N79).
-- Better Auth's 2FA plugin keeps an enrolment unconfirmed (verified = false) until the first correct TOTP code, then sets it true; an
-- unconfirmed row does not count as a second factor. Found reading better-auth 1.7.7 (PR6c). The plugin always writes it on enrol, so the
-- DEFAULT only matters for a row made another way: false, so such a row never counts as enrolled by accident.

ALTER TABLE public.two_factors ADD COLUMN verified boolean NOT NULL DEFAULT false;

-- Added to the columns auth_role may UPDATE (secret, backup_codes, updated_at); user_id and id still never change.
GRANT UPDATE (verified) ON public.two_factors TO auth_role;
