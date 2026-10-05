-- rollback: compensating migration drops app.auth_user_id(); app.accept_invite (PR7) must be dropped first (N77).
-- app.auth_user_id(): who is signed in, as told by the auth service (spec RLS M01 §3.7). The server puts the id of an AUTHENTICATED session
-- in the setting app.auth_user_id with set_config(..., true) inside its own transaction (withAuthUser); nothing from a client reaches it.
-- Unlike app.current_org() an empty value is normal, not an error: a person following an invitation link may not be signed in yet,
-- so it returns NULL. A value that is not a UUID is still an error (22P02), never a silent cast. Like app.memberships_for_user it trusts
-- its caller: only auth_role can call it, and the auth service sets the value.

CREATE FUNCTION app.auth_user_id() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE
  v text := pg_catalog.current_setting('app.auth_user_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RETURN NULL;
  END IF;
  RETURN v::uuid;
END
$$;

REVOKE ALL ON FUNCTION app.auth_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_user_id() TO auth_role;
