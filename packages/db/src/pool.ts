import pg from 'pg';

export interface DbPoolOptions {
  max?: number;
  /** Called for errors on idle connections (e.g. the database restarted). Log the code, not the message. */
  onError?: (error: Error) => void;
}

/** Connection pool for one role (give it the DATABASE_URL_APP of `app_role` for request traffic). */
export function createDbPool(connectionString: string, options: DbPoolOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: 5_000,
    application_name: 'gani-platform',
  });
  // Required: a pool emits 'error' for a broken idle connection, and an event without a listener
  // crashes the process. The pool replaces the connection by itself.
  pool.on('error', (error) => options.onError?.(error));
  return pool;
}
