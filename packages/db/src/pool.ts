import pg from 'pg';

/** Connection pool for one role (give it the DATABASE_URL_APP of `app_role` for request traffic). */
export function createDbPool(connectionString: string, options: { max?: number } = {}): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: 5_000,
    application_name: 'gani-platform',
  });
}
