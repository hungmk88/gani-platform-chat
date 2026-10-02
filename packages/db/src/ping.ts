/** Anything that can run a query: a `pg.Pool`, or a stub in tests. */
export interface Pingable {
  query(text: string): Promise<unknown>;
}

/**
 * Is the database reachable? Runs `SELECT 1` and answers within `timeoutMs`.
 * Returns `true`/`false` and never throws: the reason stays out of the answer (it can name hosts or roles).
 */
export async function pingDb(pool: Pingable, timeoutMs = 2_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  // Runs inside .then so a stub that throws synchronously is also "unreachable"; the rejection handler
  // keeps a query that fails after the timeout from becoming an unhandled rejection.
  const query = Promise.resolve()
    .then(() => pool.query('SELECT 1'))
    .then(
      () => true,
      () => false,
    );
  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
