-- rollback: compensating migration drops app.current_workspaces(), app.current_org() and schema app; only safe while no table has a policy that calls them.
-- Tenant context functions (ADR-004, spec RLS M01 §2). A missing context raises TN001 instead of returning 0 rows.

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION migration_role;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_role, support_role;

-- New functions made by migration_role are not executable by PUBLIC unless a migration grants it.
ALTER DEFAULT PRIVILEGES FOR ROLE migration_role REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- After a transaction has used set_config(..., true), the setting stays as '' (not NULL) on that connection,
-- so both NULL and '' mean "no context".
CREATE FUNCTION app.current_org() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE
  v text := pg_catalog.current_setting('app.current_org', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'tenant context missing' USING ERRCODE = 'TN001';
  END IF;
  RETURN v::uuid;
END
$$;

-- '{}' is a valid context (zero workspaces means zero rows), an empty string is not.
CREATE FUNCTION app.current_workspaces() RETURNS uuid[] LANGUAGE plpgsql STABLE AS $$
DECLARE
  v text := pg_catalog.current_setting('app.current_workspaces', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'workspace context missing' USING ERRCODE = 'TN001';
  END IF;
  RETURN v::uuid[];
END
$$;

GRANT EXECUTE ON FUNCTION app.current_org(), app.current_workspaces() TO app_role, support_role;
