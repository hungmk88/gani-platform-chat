import pg from 'pg';

/** Longest a statement may run before PostgreSQL cancels it (`57014`). */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
/** Longest a statement may wait for a lock, advisory locks included, before it fails (`55P03`). */
export const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
/** Longest a transaction may sit idle before PostgreSQL ends its connection (`25P03`) and frees its locks. */
export const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;

export interface DbPoolOptions {
  max?: number;
  /** Called for errors on idle connections (e.g. the database restarted). Log the code, not the message. */
  onError?: (error: Error) => void;
  /** Whole milliseconds, at least 1. Applies to every connection of the pool, whatever the role. */
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
  idleInTransactionTimeoutMs?: number;
}

function wholeMs(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a whole number of milliseconds, at least 1`);
  }
  return value;
}

/**
 * Connection pool for one role (give it the DATABASE_URL_APP of `app_role` for request traffic).
 *
 * Three limits are set on every connection (review A-02): without them one stuck transaction that holds the advisory lock of a
 * conversation makes every later message of it wait for ever, and each waiter keeps a connection of the pool until none is left.
 * The values are defaults; a caller that needs more passes its own. The migration runner uses its own client, not this pool.
 */
export function createDbPool(connectionString: string, options: DbPoolOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: 5_000,
    application_name: 'gani-platform',
    statement_timeout: wholeMs(
      'statementTimeoutMs',
      options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    ),
    lock_timeout: wholeMs('lockTimeoutMs', options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS),
    idle_in_transaction_session_timeout: wholeMs(
      'idleInTransactionTimeoutMs',
      options.idleInTransactionTimeoutMs ?? DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    ),
  });
  // Required: a pool emits 'error' for a broken idle connection, and an event without a listener
  // crashes the process. The pool replaces the connection by itself.
  pool.on('error', (error) => options.onError?.(error));
  return pool;
}
