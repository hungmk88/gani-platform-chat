import pg from 'pg';

const ENV = {
  app: 'DATABASE_URL_APP',
  auth: 'DATABASE_URL_AUTH',
  migration: 'DATABASE_URL_MIGRATION',
} as const;

export type Role = keyof typeof ENV;

/** Connection string for a role. A missing variable is an error, never a skipped test. */
export function url(role: Role): string {
  const value = process.env[ENV[role]];
  if (!value)
    throw new Error(`${ENV[role]} is not set: integration tests need a database (see README)`);
  return value;
}

/** Run `fn` with a connected client for `role`, always closing the connection. */
export async function withClient<T>(role: Role, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url(role) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * SQLSTATE of the error a query raises, or `undefined` when it succeeds.
 * Follows `cause`: Drizzle wraps the driver error, the SQLSTATE sits on the inner one.
 */
export async function sqlState(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
    return undefined;
  } catch (error) {
    for (let e: unknown = error; e instanceof Error; e = e.cause) {
      if ('code' in e && typeof e.code === 'string') return e.code;
    }
    throw error;
  }
}
