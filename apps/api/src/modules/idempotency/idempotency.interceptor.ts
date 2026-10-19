import type { IncomingMessage, ServerResponse } from 'node:http';

import { beginIdempotent, completeIdempotent, failIdempotent, type TenantTx } from '@gani/db';
import {
  Inject,
  Injectable,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, from, mergeMap, of, type Observable } from 'rxjs';

import { ValidationFailedError } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { StoredProblem, toProblem } from '../request-context/problem.filter.js';
import { extensionsOf, problem, type Problem } from '../request-context/problem.js';
import { currentRequestContext } from '../request-context/request-context.js';
import { IdempotencyInProgressError, IdempotencyKeyReusedError } from './idempotency.errors.js';
import { requestHash } from './request-hash.js';

const KEY = /^[!-~]{1,255}$/;
// jsonb keeps no key order: the problem is built again, so its members come in their usual order.
const kept = (p: Problem): Problem =>
  problem(p.status, p.code, p.detail, p.traceId, extensionsOf(p));

/**
 * Idempotency-Key on a POST that creates or changes data (Brief P9, N134). The key is claimed in a short transaction of its own,
 * committed before the handler runs, so the same key sent again at once is told `idempotency_in_progress` instead of running twice.
 * The handler's answer, a 2xx or a 4xx, is then kept and given back to the same request sent again for 24 hours; a 5xx frees the
 * key, so the client may try again. The same key with another request is 422 `idempotency_key_reused`.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<IncomingMessage & { body?: unknown; originalUrl?: string }>();
    const res = http.getResponse<ServerResponse>();
    const header = req.headers['idempotency-key'];
    if (typeof header !== 'string' || !KEY.test(header))
      throw new ValidationFailedError(['Idempotency-Key: required, 1 to 255 printable characters']);
    const ctx = currentRequestContext();
    const method = req.method ?? 'POST';
    const path = (req.originalUrl ?? req.url ?? '/').split('?')[0] ?? '/';
    const claim = { userId: ctx.userId, key: header };
    const run = <T>(fn: (tx: TenantTx) => Promise<T>) => this.database.withTenant(ctx, fn);

    const begun = run((tx) =>
      beginIdempotent(tx, {
        ...claim,
        method,
        path,
        requestHash: requestHash(method, path, req.body),
      }),
    );
    return from(begun).pipe(
      mergeMap((state) => {
        if (state.kind === 'mismatch') throw new IdempotencyKeyReusedError();
        if (state.kind === 'in_progress') throw new IdempotencyInProgressError();
        if (state.kind === 'replay' && state.status >= 400)
          throw new StoredProblem(kept(state.body as Problem));
        if (state.kind === 'replay') return of(state.body);
        // Nest set the handler's status (201 for a POST, or its @HttpCode) before the interceptors ran: that is the status answered.
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await run((tx) =>
              completeIdempotent(tx, { ...claim, status: res.statusCode, body: body ?? null }),
            );
            return body;
          }),
          catchError(async (error: unknown) => {
            const answer = toProblem(error, ctx.traceId);
            await run<unknown>((tx) =>
              answer.status < 500
                ? completeIdempotent(tx, { ...claim, status: answer.status, body: answer })
                : failIdempotent(tx, claim),
            );
            throw error;
          }),
        );
      }),
    );
  }
}

/** Marks a handler as idempotent: it then requires an Idempotency-Key header (P9). */
export const Idempotent = () => UseInterceptors(IdempotencyInterceptor);
