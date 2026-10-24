-- rollback: compensating migration drops app.reset_member_two_factor(uuid); the second factor of a member can then not be reset from the application.
-- "Đặt lại 2FA của người khác" (Q-U20-1, Phụ lục B, N155): an Owner or an Admin turns off the second factor of a member of their
-- organisation who lost it; the person must enrol again, and every session of theirs ends. users, two_factors and sessions are global
-- tables that app_role may not touch (a grant would reach every person of every organisation), so this one function does it, as its
-- owner (SECURITY DEFINER, ADR-004), for one member of app.current_org() only: the organisation comes from the tenant transaction, never
-- from the caller. Who may reset whom (an Owner or an Admin, not themselves, an Admin not an Owner) is the caller's check, as for the
-- view app.org_member_directory (N12); the API locks the member and checks before it calls.
-- A person is global: resetting them turns off their second factor in every organisation. So the function refuses ('shared') a person
-- who is also a member of another organisation (any status but pending, which has no person yet) or a platform operator: one company
-- never lowers the protection of an account another company relies on.
-- Nothing is deleted. two_factors.verified = false makes the enrolment unconfirmed (Better Auth then counts no second factor and, at the
-- next enable, writes a new secret and new backup codes over the row); sessions end with revoked_at, as Better Auth ends one (ADR-003).
-- Returns 'reset', 'not_found' (no such active or suspended member in this organisation, or their person is deleted) or 'shared'.

CREATE FUNCTION app.reset_member_two_factor(p_member_id uuid)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  v_org uuid := app.current_org();
  v_user public.users%ROWTYPE;
BEGIN
  SELECT u.* INTO v_user
  FROM public.org_members m
  JOIN public.users u ON u.id = m.user_id
  WHERE m.id = p_member_id
    AND m.org_id = v_org
    AND m.status <> 'pending'
    AND m.deleted_at IS NULL
    AND u.deleted_at IS NULL
  FOR UPDATE OF u;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_user.is_platform_operator OR EXISTS (
    SELECT 1 FROM public.org_members o
    WHERE o.user_id = v_user.id AND o.org_id <> v_org AND o.deleted_at IS NULL
  ) THEN
    RETURN 'shared';
  END IF;

  UPDATE public.users SET two_factor_enabled = false, updated_at = pg_catalog.now()
  WHERE id = v_user.id;
  UPDATE public.two_factors
  SET verified = false, failed_verification_count = 0, locked_until = NULL, updated_at = pg_catalog.now()
  WHERE user_id = v_user.id;
  UPDATE public.sessions SET revoked_at = pg_catalog.now(), updated_at = pg_catalog.now()
  WHERE user_id = v_user.id AND revoked_at IS NULL;
  RETURN 'reset';
END
$$;

REVOKE ALL ON FUNCTION app.reset_member_two_factor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reset_member_two_factor(uuid) TO app_role;
