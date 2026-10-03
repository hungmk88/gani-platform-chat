-- rollback: compensating migration drops app.create_log_partitions(regclass, integer) and app.secure_log_partition(regclass, regclass); partitions already created are left in place.
-- Monthly partitions for the log tables (spec RLS M01 §6). Not SECURITY DEFINER: both functions run as the caller
-- (migration_role) and nobody else can execute them. Names come from the catalog and integers via format(%I).

-- One step makes a partition as safe as its parent: RLS on, no application role may touch it, parent policies copied.
CREATE FUNCTION app.secure_log_partition(parent regclass, child regclass) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  pol record;
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', child);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', child);
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, app_role, auth_role, support_role', child);
  FOR pol IN
    SELECT p.polname, p.polpermissive, p.polcmd,
           coalesce((SELECT string_agg(quote_ident(r.rolname), ', ') FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'PUBLIC') AS roles,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
    FROM pg_policy p WHERE p.polrelid = parent
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
  END LOOP;
END
$$;

-- Creates the DEFAULT partition and this month plus months_ahead more (bounds in UTC). Idempotent; returns how many it made.
CREATE FUNCTION app.create_log_partitions(parent regclass, months_ahead integer) RETURNS integer
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  made integer := 0;
  nsp text;
  rel text;
  child text;
  from_ts timestamptz;
  to_ts timestamptz;
BEGIN
  SELECT n.nspname, c.relname INTO nsp, rel
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = parent AND c.relkind = 'p';
  IF rel IS NULL THEN
    RAISE EXCEPTION 'not a partitioned table: %', parent;
  END IF;
  IF months_ahead < 0 OR months_ahead > 12 THEN
    RAISE EXCEPTION 'months_ahead must be between 0 and 12';
  END IF;

  child := format('%I.%I', nsp, rel || '_default');
  IF to_regclass(child) IS NULL THEN
    EXECUTE format('CREATE TABLE %s PARTITION OF %s DEFAULT', child, parent);
    PERFORM app.secure_log_partition(parent, child::regclass);
    made := made + 1;
  END IF;

  FOR i IN 0..months_ahead LOOP
    from_ts := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i)) AT TIME ZONE 'UTC';
    to_ts := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i + 1)) AT TIME ZONE 'UTC';
    child := format('%I.%I', nsp, rel || to_char(from_ts AT TIME ZONE 'UTC', '"_y"YYYY"m"MM'));
    IF to_regclass(child) IS NULL THEN
      EXECUTE format('CREATE TABLE %s PARTITION OF %s FOR VALUES FROM (%L) TO (%L)', child, parent, from_ts, to_ts);
      PERFORM app.secure_log_partition(parent, child::regclass);
      made := made + 1;
    END IF;
  END LOOP;
  RETURN made;
END
$$;

REVOKE ALL ON FUNCTION app.secure_log_partition(regclass, regclass), app.create_log_partitions(regclass, integer) FROM PUBLIC;
