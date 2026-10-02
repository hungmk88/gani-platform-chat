import { AsyncLocalStorage } from 'node:async_hooks';

import { assertUuid } from './validate.js';

/**
 * Who a request acts for. `orgId` and `workspaceIds` come from the server (session, API key, job payload),
 * never from a client-supplied field (CLAUDE.md rule 1).
 */
export interface TenantContext {
  readonly orgId: string;
  readonly workspaceIds: readonly string[];
}

/** `currentTenantContext()` was called outside `runWithTenantContext` / `withTenant`: a bug, not a user error. */
export class TenantContextMissingError extends Error {
  constructor() {
    super('tenant context missing: wrap the work in withTenant()');
    this.name = 'TenantContextMissingError';
  }
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Validate, normalise (lower-case, drop duplicates) and freeze a context. Throws on a non-UUID. */
export function normalizeTenantContext(ctx: TenantContext): TenantContext {
  const orgId = assertUuid(ctx.orgId, 'orgId');
  const workspaceIds = [...new Set(ctx.workspaceIds.map((id) => assertUuid(id, 'workspaceId')))];
  return Object.freeze({ orgId, workspaceIds: Object.freeze(workspaceIds) });
}

/** Run `fn` with `ctx` as the current context. A nested call replaces the outer context for its own scope only. */
export function runWithTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(normalizeTenantContext(ctx), fn);
}

export function currentTenantContext(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) throw new TenantContextMissingError();
  return ctx;
}
