-- rollback: compensating migration drops app.copy_policies_to_partitions(regclass).
-- Copies onto the existing partitions of a table the parent policies they do not have yet (spec RLS M01 §6). New partitions
-- already get every parent policy from app.secure_log_partition. Like it: not SECURITY DEFINER, only migration_role runs it,
-- idempotent. A second function, not an edit of the first: an applied function is never changed.

CREATE FUNCTION app.copy_policies_to_partitions(parent regclass) RETURNS integer
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  child regclass;
  pol record;
  made integer := 0;
BEGIN
  FOR child IN SELECT i.inhrelid::regclass FROM pg_inherits i WHERE i.inhparent = parent LOOP
    FOR pol IN
      SELECT p.polname, p.polpermissive, p.polcmd,
             coalesce((SELECT string_agg(quote_ident(r.rolname), ', ') FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'PUBLIC') AS roles,
             pg_get_expr(p.polqual, p.polrelid) AS qual,
             pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
      FROM pg_policy p
      WHERE p.polrelid = parent
        AND NOT EXISTS (SELECT 1 FROM pg_policy c WHERE c.polrelid = child AND c.polname = p.polname)
    LOOP
      EXECUTE format(
        'CREATE POLICY %I ON %s AS %s FOR %s TO %s%s%s',
        pol.polname, child,
        CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
        pol.roles,
        CASE WHEN pol.qual IS NOT NULL THEN format(' USING (%s)', pol.qual) ELSE '' END,
        CASE WHEN pol.with_check IS NOT NULL THEN format(' WITH CHECK (%s)', pol.with_check) ELSE '' END
      );
      made := made + 1;
    END LOOP;
  END LOOP;
  RETURN made;
END
$$;

REVOKE ALL ON FUNCTION app.copy_policies_to_partitions(regclass) FROM PUBLIC;
