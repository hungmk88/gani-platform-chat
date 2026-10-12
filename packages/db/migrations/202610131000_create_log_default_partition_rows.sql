-- rollback: compensating migration drops app.log_default_partition_rows(); nothing else depends on it.
-- How many rows each log table holds in its DEFAULT partition, so the partition maintenance (PM-2, N110) can warn. app_role cannot read
-- a partition (spec RLS M01 case 9b: that is deliberate), so the answer comes from a SECURITY DEFINER function. It takes no argument and
-- names no table of its own: the tables are found in the catalog by the same rule as app.ensure_log_partitions (partitioned by RANGE on
-- one timestamptz column, with a `<name>_default` partition). The count is capped: it stops at 1001 rows, so a DEFAULT that has grown
-- large is never scanned whole; 1001 means "more than a thousand". It returns numbers and table names, never a row.
CREATE FUNCTION app.log_default_partition_rows()
  RETURNS TABLE (parent text, rows_capped bigint)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT n.nspname AS nsp, c.relname AS rel
    FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = pt.partattrs[0]
    WHERE n.nspname = 'public' AND pt.partstrat = 'r' AND pt.partnatts = 1 AND a.atttypid = 'timestamptz'::regtype
      AND EXISTS (SELECT 1 FROM pg_inherits i JOIN pg_class d ON d.oid = i.inhrelid
                  WHERE i.inhparent = c.oid AND d.relname = c.relname || '_default')
    ORDER BY c.relname
  LOOP
    parent := t.rel;
    EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM %I.%I LIMIT 1001) AS capped', t.nsp, t.rel || '_default')
      INTO rows_capped;
    RETURN NEXT;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION app.log_default_partition_rows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.log_default_partition_rows() TO app_role;
