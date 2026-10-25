-- rollback: compensating migration drops app.audit_own_account_event(text, uuid[], uuid[]); a change or reset of a password is then logged by no organisation.
-- Audit of what a person does to their own account (N162): a password changed while signed in, or reset by a link. The account is
-- global, but audit_logs belongs to an organisation, and auth_role (the pool of Better Auth, the only one that sees the account) may not
-- write it. So this one function writes, as its owner (SECURITY DEFINER, ADR-004), one row in EACH organisation where the person is an
-- active member, so that every company they work for sees it. Who: app.auth_user_id() only, the person the auth service set for its own
-- transaction (withAuthUser), never a caller's argument. The caller passes the organisations it read with app.memberships_for_user and
-- a new UUIDv7 for each (the database makes no UUIDv7); an organisation where the person is not an active member is skipped, so a
-- caller cannot write into a company that is not the person's. Only these two actions; the row holds ids, never an email.
-- Returns how many rows it wrote.

CREATE FUNCTION app.audit_own_account_event(p_action text, p_org_ids uuid[], p_ids uuid[])
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  v_user uuid := app.auth_user_id();
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'audit_own_account_event: no signed-in person' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('user.password_changed', 'user.password_reset') THEN
    RAISE EXCEPTION 'audit_own_account_event: unknown action' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.cardinality(p_org_ids) IS DISTINCT FROM pg_catalog.cardinality(p_ids)
    OR (SELECT pg_catalog.count(DISTINCT o) FROM pg_catalog.unnest(p_org_ids) AS o) <> pg_catalog.cardinality(p_org_ids) THEN
    RAISE EXCEPTION 'audit_own_account_event: one new id per organisation, each organisation once' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_logs (id, org_id, actor_user_id, action, target_type, target_id)
  SELECT i.id, i.org_id, v_user, p_action, 'user', v_user
  -- Unqualified: the two-array form is syntax of FROM, not a function pg_catalog has (search_path above starts with it anyway).
  FROM unnest(p_org_ids, p_ids) AS i (org_id, id)
  WHERE EXISTS (
    SELECT 1 FROM app.memberships_for_user(v_user) m WHERE m.org_id = i.org_id AND m.status = 'active'
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION app.audit_own_account_event(text, uuid[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit_own_account_event(text, uuid[], uuid[]) TO auth_role;
