import type pg from 'pg';

/**
 * Runs `fn` on the app_role client inside a transaction whose tenant context is `org` and `workspaceIds` (null leaves the
 * workspaces unset, as a TenantTx that forgot them would). The transaction is always rolled back.
 */
export async function asApp<T>(
  app: pg.Client,
  org: string,
  workspaceIds: string[] | null,
  fn: () => Promise<T>,
): Promise<T> {
  await app.query('BEGIN');
  try {
    await app.query("SELECT set_config('app.current_org', $1, true)", [org]);
    if (workspaceIds) {
      await app.query("SELECT set_config('app.current_workspaces', $1, true)", [
        `{${workspaceIds.join(',')}}`,
      ]);
    }
    return await fn();
  } finally {
    await app.query('ROLLBACK').catch(() => undefined);
  }
}
