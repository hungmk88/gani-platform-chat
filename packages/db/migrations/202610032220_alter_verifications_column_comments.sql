-- rollback: compensating migration sets both comments back to NULL; nothing depends on them (N79).
-- Corrects what migration 202610032020 says (an applied migration file cannot be edited: the runner compares checksums).
-- Reading better-auth 1.7.7 (PR6c): the token of its own flows (reset password, ...) lives in identifier, and value holds the payload
-- (for example a user id), NOT a hash. identifier can be stored hashed with verification.storeIdentifier = 'hashed'.
-- The one-time token of OUR invitation flow (PR7, spec §3.7) is written by app code, and there the hash of the token goes in value.

COMMENT ON COLUMN public.verifications.identifier IS
  'Better Auth: what the token is for and, in its own flows, the token itself (hash it with verification.storeIdentifier = hashed). Our invitation flow: who it is for.';
COMMENT ON COLUMN public.verifications.value IS
  'Better Auth: the payload (for example a user id), not a hash. Our invitation flow: SHA-256 hash of the one-time token, never the token.';
