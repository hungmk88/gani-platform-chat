-- rollback: compensating migration drops constraints sessions_ip_address_check, sessions_user_agent_check and the two columns; safe, they hold nothing (N79).
-- Better Auth writes ip_address and user_agent on EVERY new session and its Drizzle adapter fails when the table has no such column
-- (found reading better-auth 1.7.7, PR6c). They are personal data and nothing here needs them, so the columns exist only to satisfy the library
-- and stay empty: PR6c-2 turns IP tracking off (advanced.ipAddress.disableIpTracking) and blanks the user agent in a session hook.
-- The library writes '' (not NULL) when there is no value. The CHECKs allow only NULL or '': a code path that forgets the hook then fails
-- loudly at sign-in instead of storing personal data silently. auth_role already has INSERT on the table; UPDATE stays revoked_at and
-- updated_at, so neither column can be filled in later.

ALTER TABLE public.sessions
  ADD COLUMN ip_address text,
  ADD COLUMN user_agent text,
  ADD CONSTRAINT sessions_ip_address_check CHECK (ip_address IS NULL OR ip_address = ''),
  ADD CONSTRAINT sessions_user_agent_check CHECK (user_agent IS NULL OR user_agent = '');
