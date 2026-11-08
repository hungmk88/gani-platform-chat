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

/**
 * A platform operator inside an access session (U79, N207, P11b-1): the organisation is the session's (`app.access_session_org`), never
 * the request's. It is no role in the organisation and opens no tenant context: a module that lets operators in asks for it with
 * `currentActorContext()` and opens its own transaction; every other one asks `currentRequestContext()` and is refused (fail-closed).
 */
export interface OperatorRequestContext {
  readonly role: 'platform_operator';
  readonly userId: string;
  readonly orgId: string;
  readonly accessSessionId: string;
  readonly workspaceIds: readonly string[];
  readonly resolvedAt: Date;
  readonly traceId: string;
}

/** A member's context was asked for in a request of a platform operator: 403 `forbidden` (ProblemFilter), never a member's answer. */
export class OperatorAccessDeniedError extends Error {
  readonly status = 403;
  readonly code = 'forbidden';
  constructor() {
    super('This is not open to a platform access session.');
    this.name = 'OperatorAccessDeniedError';
  }
}

const storage = new AsyncLocalStorage<RequestContext | OperatorRequestContext>();

/** The context is frozen, so a handler cannot widen its own workspaces. A nested call replaces the outer one for its scope only. */
export function runWithRequestContext<T>(
  ctx: RequestContext | OperatorRequestContext,
  fn: () => T,
): T {
  const frozen = Object.freeze({ ...ctx, workspaceIds: Object.freeze([...ctx.workspaceIds]) });
  return storage.run(frozen, fn);
}

/** The traceId of the request in progress, or undefined outside one (a route before the tenant middleware, such as a 404 of the router). */
export function requestTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

/** The member the request acts for. A request of a platform operator is refused here: a module opens to operators only on purpose. */
export function currentRequestContext(): RequestContext {
  const ctx = currentActorContext();
  if (ctx.role === 'platform_operator') throw new OperatorAccessDeniedError();
  return ctx;
}

/** A member or a platform operator in an access session: for the modules that let operators in (P11b-2 on), and only those. */
export function currentActorContext(): RequestContext | OperatorRequestContext {
  const ctx = storage.getStore();
  if (!ctx) throw new RequestContextMissingError();
  return ctx;
}
