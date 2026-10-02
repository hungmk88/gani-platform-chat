import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import {
  currentTenantContext,
  normalizeTenantContext,
  runWithTenantContext,
  type TenantContext,
} from './tenant-context.js';
import { toPgUuidArray } from './validate.js';

/** The transaction handle `fn` receives: every query on it runs with the tenant context set. */
export type TenantTx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/**
 * Run `fn` in one transaction that acts for `ctx` (ADR-002, ADR-004, spec RLS M01 §2).
 *
 * The first statement is `set_config(..., true)`, so the context lasts until COMMIT/ROLLBACK and cannot leak to
 * the next user of the pooled connection. Parameters are bound, which keeps it safe behind a transaction pooler.
 * An invalid context throws before any connection is taken.
 *
 * Nesting: calling `withTenant` inside `fn` is allowed. The inner call is a separate transaction on its own
 * connection with its own context; it replaces the outer context (also `currentTenantContext()`) only inside
 * itself, and the outer transaction is not affected. It needs a free pooled connection: with `max: 1` it waits forever.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const context = normalizeTenantContext(ctx);
  const workspaces = toPgUuidArray(context.workspaceIds);
  return drizzle({ client: pool }).transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_org', ${context.orgId}, true), set_config('app.current_workspaces', ${workspaces}, true)`,
    );
    return runWithTenantContext(context, () => fn(tx));
  });
}

/** Like `withTenant`, with the context taken from the surrounding `runWithTenantContext`/`withTenant`. */
export async function withCurrentTenant<T>(
  pool: pg.Pool,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return withTenant(pool, currentTenantContext(), fn);
}
