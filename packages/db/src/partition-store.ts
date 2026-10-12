import type pg from 'pg';

// The two questions the partition maintenance asks the database (N110): make the next months of the log tables, and say how many rows
// have fallen into a DEFAULT partition. Both go through SECURITY DEFINER functions, because app_role can make no table and read no
// partition. Neither takes a table name and neither returns a row of a table. This file logs nothing.

/** How many partitions were made for one log table, and the months it could not make because DEFAULT already holds rows of them. */
export interface EnsuredPartitions {
  readonly parent: string;
  readonly created: number;
  /** `YYYY-MM`. Nothing was moved: a person decides what happens to those rows (N110). */
  readonly blockedMonths: readonly string[];
}

/** The DEFAULT partition of a log table: `rowsCapped` is the count, which stops at `DEFAULT_ROWS_CAP`. */
export interface DefaultPartitionRows {
  readonly parent: string;
  readonly rowsCapped: number;
}

/** The count of `app.log_default_partition_rows` stops here: this value means "more than a thousand". */
export const DEFAULT_ROWS_CAP = 1001;

/**
 * Makes this month and `monthsAhead` more (1..12, 22023 otherwise) for every log table, through `app.ensure_log_partitions`. Safe to call
 * from several workers at once and again and again. A statement that waits more than `lock_timeout` for a table lock raises 55P03: the
 * caller tries again later.
 */
export async function ensureLogPartitions(
  pool: pg.Pool,
  monthsAhead: number,
): Promise<EnsuredPartitions[]> {
  const { rows } = await pool.query<{
    parent: string;
    created: number;
    blocked_months: string[];
  }>('SELECT parent, created, blocked_months FROM app.ensure_log_partitions($1)', [monthsAhead]);
  return rows.map((r) => ({
    parent: r.parent,
    created: r.created,
    blockedMonths: r.blocked_months,
  }));
}

/** The rows each log table holds in its DEFAULT partition, capped; a table with 0 has nothing to look at. */
export async function defaultPartitionRows(pool: pg.Pool): Promise<DefaultPartitionRows[]> {
  const { rows } = await pool.query<{ parent: string; rows_capped: string }>(
    'SELECT parent, rows_capped FROM app.log_default_partition_rows()',
  );
  return rows.map((r) => ({ parent: r.parent, rowsCapped: Number(r.rows_capped) }));
}
