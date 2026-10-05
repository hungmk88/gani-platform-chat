-- rollback: compensating migration revokes these column grants of auth_role on public.users (N77).
-- What auth_role may do with users (spec RLS M01 §3.2). Column lists name every allowed column, so a column added later stays hidden.
-- created_at and updated_at are readable too (N77): Better Auth models them on a user. pending_password_since stays hidden.
-- No INSERT and no DELETE: a user is created by app.accept_invite (PR7) or by a migration_role script (N25).
-- status and email_verified_at are NOT updatable yet: they come with the trigger that allows only pending_password -> active (PR6b),
-- so there is no moment where auth_role can set them freely.

GRANT SELECT (id, email, email_verified_at, display_name, locale, status, is_platform_operator, two_factor_enabled,
              failed_login_count, locked_until, deleted_at, created_at, updated_at)
  ON public.users TO auth_role;
GRANT UPDATE (failed_login_count, locked_until, two_factor_enabled, display_name, updated_at)
  ON public.users TO auth_role;
