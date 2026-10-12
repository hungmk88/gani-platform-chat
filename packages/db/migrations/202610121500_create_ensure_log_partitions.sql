-- rollback: compensating migration drops app.ensure_log_partitions(integer); partitions it created are left in place and stay valid.
-- Keeps the monthly partitions of every log table ahead of the clock (N67, N110; review B-01). The worker calls it every day (PM-2) as
-- app_role, which cannot make tables: the function is SECURITY DEFINER and runs as its owner. It takes no table name from its caller:
-- the tables are the partitioned ones of schema public that have a `<name>_default` partition, found in the catalog, so a log table
-- added later is covered by itself. Brief P8 M07 lists `ai_usage_logs`, which does not exist yet: when it does, it is picked up here
-- and the spec of this function (the set of tables it expects) goes red on purpose, to be updated with it.
--
-- A month is made only when the DEFAULT partition holds no row of that month: PostgreSQL refuses (23514) to make a partition whose
-- range already has rows in DEFAULT. Such a month is skipped and reported in `blocked_months`, nothing is moved and nothing raises, so
-- one stuck table does not leave the other five without partitions. Moving those rows is a decision of a person (runbook, not here).
-- The DEFAULT partition stays: a row outside every range is kept there instead of failing the write that carries it.
--
-- The advisory lock uses the two-integer form (its own key space: not the single key of the migration runner, nor the one of
-- insertMessage) so two callers wait for each other instead of both trying to make the same table. A statement the pool's lock_timeout
-- (5 s) stops raises 55P03; the next call tries again.
CREATE FUNCTION app.ensure_log_partitions(p_months_ahead integer DEFAULT 3)
  RETURNS TABLE (parent text, created integer, blocked_months text[])
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  t record;
  m integer;
  from_ts timestamptz;
  to_ts timestamptz;
  child text;
  rows_in_default boolean;
  made integer;
  stuck text[];
BEGIN
  IF p_months_ahead IS NULL OR p_months_ahead < 1 OR p_months_ahead > 12 THEN
    RAISE EXCEPTION 'p_months_ahead must be between 1 and 12' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(7265002, 1);

  FOR t IN
    SELECT n.nspname AS nsp, c.relname AS rel, a.attname AS keycol
    FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = pt.partattrs[0]
    WHERE n.nspname = 'public' AND pt.partstrat = 'r' AND pt.partnatts = 1 AND a.atttypid = 'timestamptz'::regtype
      AND EXISTS (SELECT 1 FROM pg_inherits i JOIN pg_class d ON d.oid = i.inhrelid
                  WHERE i.inhparent = c.oid AND d.relname = c.relname || '_default')
    ORDER BY c.relname
  LOOP
    made := 0;
    stuck := ARRAY[]::text[];
    FOR m IN 0..p_months_ahead LOOP
      from_ts := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => m)) AT TIME ZONE 'UTC';
      to_ts := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => m + 1)) AT TIME ZONE 'UTC';
      child := format('%I.%I', t.nsp, t.rel || to_char(from_ts AT TIME ZONE 'UTC', '"_y"YYYY"m"MM'));
      CONTINUE WHEN to_regclass(child) IS NOT NULL;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I >= %L AND %I < %L)',
                     t.nsp, t.rel || '_default', t.keycol, from_ts, t.keycol, to_ts)
        INTO rows_in_default;
      IF rows_in_default THEN
        stuck := stuck || to_char(from_ts AT TIME ZONE 'UTC', 'YYYY-MM');
        CONTINUE;
      END IF;
      EXECUTE format('CREATE TABLE %s PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)', child, t.nsp, t.rel, from_ts, to_ts);
      PERFORM app.secure_log_partition(format('%I.%I', t.nsp, t.rel)::regclass, child::regclass);
      made := made + 1;
    END LOOP;
    parent := t.rel;
    created := made;
    blocked_months := stuck;
    RETURN NEXT;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION app.ensure_log_partitions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ensure_log_partitions(integer) TO app_role;
