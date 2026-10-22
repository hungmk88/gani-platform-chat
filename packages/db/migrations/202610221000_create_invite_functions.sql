-- rollback: compensating migration drops app.accept_invite(text, uuid) and app.lookup_invite(text); invitations then cannot be read or accepted.
-- The two functions of an invitation (spec RLS M01 §3.7, ADR-004, N147). The person following the link has no tenant context yet, so they
-- run as their owner (SECURITY DEFINER) and only auth_role may call them. They take the token as text and hash it here (SHA-256, the
-- column holds 32 bytes); org, email and identity never come from the caller: the email is the one of the invitation, the person
-- signed in is app.auth_user_id() (set by the server from an authenticated session, withAuthUser). The one extra parameter of
-- accept_invite is the id of a person to create, a UUIDv7 made by the server (rule 2): PostgreSQL 16 cannot make one.
-- Every refusal of accept_invite is the same error (IV001 'invite_invalid'), whatever the reason (wrong, expired or used token, another
-- email, an account that must sign in first, already a member): nobody learns whether a token or an email exists (§3.7 step 4).

-- What the invitation page shows before accepting: nothing when the token is not a live invitation.
CREATE FUNCTION app.lookup_invite(p_token text)
  RETURNS TABLE (member_id uuid, org_id uuid, invited_email text, role text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT m.id, m.org_id, m.invited_email, m.role
    FROM public.org_members m
    JOIN public.organizations o ON o.id = m.org_id
    WHERE m.invite_token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
      AND m.status = 'pending'
      AND m.invite_expires_at > pg_catalog.now()
      AND m.deleted_at IS NULL
      AND o.deleted_at IS NULL
  $$;

-- Accepts once: the membership becomes active and the token is cleared in the same statement. Steps of §3.7:
-- - signed in (app.auth_user_id): that person, whose email must be the invited one;
-- - not signed in: a new person `pending_password` (they set a password next, PR7 API), or one who is still `pending_password`
--   (invited by a second organisation: their 24 hours start again); an `active` account must sign in first.
CREATE FUNCTION app.accept_invite(p_token text, p_new_user_id uuid)
  RETURNS TABLE (user_id uuid, org_id uuid, role text)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  v_member public.org_members%ROWTYPE;
  v_auth uuid := app.auth_user_id();
  v_user public.users%ROWTYPE;
BEGIN
  SELECT m.* INTO v_member
  FROM public.org_members m
  JOIN public.organizations o ON o.id = m.org_id
  WHERE m.invite_token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
    AND m.status = 'pending'
    AND m.invite_expires_at > pg_catalog.now()
    AND m.deleted_at IS NULL
    AND o.deleted_at IS NULL
  FOR UPDATE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'IV001';
  END IF;

  IF v_auth IS NOT NULL THEN
    SELECT u.* INTO v_user FROM public.users u WHERE u.id = v_auth AND u.deleted_at IS NULL;
    IF NOT FOUND OR v_user.email <> v_member.invited_email THEN
      RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'IV001';
    END IF;
  ELSE
    SELECT u.* INTO v_user FROM public.users u WHERE u.email = v_member.invited_email FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.users (id, email, status, pending_password_since)
      VALUES (p_new_user_id, v_member.invited_email, 'pending_password', pg_catalog.now())
      RETURNING * INTO v_user;
    ELSIF v_user.deleted_at IS NOT NULL OR v_user.status <> 'pending_password' THEN
      RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'IV001';
    ELSE
      UPDATE public.users SET pending_password_since = pg_catalog.now(), updated_at = pg_catalog.now()
      WHERE id = v_user.id;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.org_members m WHERE m.org_id = v_member.org_id AND m.user_id = v_user.id
  ) THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'IV001';
  END IF;

  UPDATE public.org_members m
  SET user_id = v_user.id, status = 'active', invite_token_hash = NULL, invite_expires_at = NULL,
      updated_at = pg_catalog.now()
  WHERE m.id = v_member.id;

  RETURN QUERY SELECT v_user.id, v_member.org_id, v_member.role;
END
$$;

REVOKE ALL ON FUNCTION app.lookup_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.accept_invite(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lookup_invite(text) TO auth_role;
GRANT EXECUTE ON FUNCTION app.accept_invite(text, uuid) TO auth_role;
