import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

/**
 * Run `fn` in one transaction that tells the database who is signed in (spec RLS M01 §3.7, N77), for app.auth_user_id().
 * Use it on the pool of `auth_role`, with the id of an AUTHENTICATED session: never a value from a request body, query or header.
 *
 * Like `withTenant`, the setting is `set_config(..., true)`: it ends with the transaction and cannot reach the next user of the
 * pooled connection. Unlike `withTenant` it keeps nothing in AsyncLocalStorage, so no other code can inherit the identity.
 * A value that is not a UUID throws before any connection is taken.
 */
export async function withAuthUser<T>(
  pool: pg.Pool,
  userId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const id = assertUuid(userId, 'userId');
  return drizzle({ client: pool }).transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.auth_user_id', ${id}, true)`);
    return fn(tx);
  });
}
