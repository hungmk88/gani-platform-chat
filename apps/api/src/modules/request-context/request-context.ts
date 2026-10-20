import { AsyncLocalStorage } from 'node:async_hooks';

import type { OrgRole } from '@gani/db';

/**
 * Who a request acts for, decided by the server from the session and the database, never by the client (rule 1). Built once
 * per request by the tenant middleware (6d-2b). `resolvedAt` is when the session was looked up: a later layer that sees the same
 * value knows it did not ask again.
 */
export interface RequestContext {
  readonly userId: string;
  readonly orgId: string;
  readonly role: OrgRole;
  readonly workspaceIds: readonly string[];
  readonly resolvedAt: Date;
  /** Made by the tenant middleware for this request: every problem+json of the request and every log line about it carry it (N132). */
  readonly traceId: string;
}

/** `currentRequestContext()` outside a request that has one: a bug in the wiring, never an answer for a user (no default). */
export class RequestContextMissingError extends Error {
  constructor() {
    super('request context missing: the request did not pass the tenant middleware');
    this.name = 'RequestContextMissingError';
  }
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The context is frozen, so a handler cannot widen its own workspaces. A nested call replaces the outer one for its scope only. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  const frozen = Object.freeze({ ...ctx, workspaceIds: Object.freeze([...ctx.workspaceIds]) });
  return storage.run(frozen, fn);
}

/** The traceId of the request in progress, or undefined outside one (a route before the tenant middleware, such as a 404 of the router). */
export function requestTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

export function currentRequestContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) throw new RequestContextMissingError();
  return ctx;
}
