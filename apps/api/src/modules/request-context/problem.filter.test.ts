import { InvalidTransitionError } from '@gani/domain';
import { Logger, MethodNotAllowedException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConversationNotFoundError, VersionConflictError } from '../conversations/errors.js';
import { codeOfStatus, ProblemFilter, toProblem } from './problem.filter.js';
import { runWithRequestContext } from './request-context.js';

const TRACE = '0190a000-0000-7000-8000-000000000001';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toProblem (AR-03)', () => {
  it('names an HttpException of Nest by its status, with no detail', () => {
    expect(toProblem(new NotFoundException('Cannot GET /x'), TRACE)).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'not_found',
    });
    expect(toProblem(new MethodNotAllowedException(), TRACE)).toMatchObject({
      status: 405,
      code: 'method_not_allowed',
    });
  });

  it('answers an error of ours with its status and code, and its fixed sentence as the detail', () => {
    expect(toProblem(new ConversationNotFoundError(), TRACE)).toMatchObject({
      status: 404,
      code: 'not_found',
      detail: 'conversation not found',
    });
    expect(toProblem(new VersionConflictError(), TRACE)).toMatchObject({
      status: 409,
      code: 'version_conflict',
    });
    expect(
      toProblem(new InvalidTransitionError('CLOSED', 'claim', 'not_in_table'), TRACE),
    ).toMatchObject({ status: 409, code: 'invalid_transition' });
  });

  it('turns anything else into 500 internal_error with the traceId and none of the message', () => {
    const body = toProblem(new Error('Failed query: params: someone@example.test'), TRACE);
    expect(body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'internal_error',
      detail: 'Something went wrong. Try again.',
      traceId: TRACE,
    });
    expect(toProblem('a string', TRACE)).toMatchObject({ status: 500 });
    expect(toProblem({ status: 404, code: 'not a code!' }, TRACE)).toMatchObject({ status: 500 });
  });
});

describe('ProblemFilter', () => {
  it('logs a 500 by name, code and traceId only, never the message', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = { headersSent: false, statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    new ProblemFilter().catch(
      Object.assign(new Error('params: someone@example.test'), { code: '57014' }),
      host as never,
    );
    expect(res.statusCode).toBe(500);
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toMatch(/^request failed \(Error, 57014\) trace=[0-9a-f-]{36}$/);
    expect(line).not.toContain('someone@example.test');
  });

  it("answers with the request's own traceId when the tenant middleware gave it one (N132)", () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = { headersSent: false, statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    const ctx = {
      userId: 'u',
      orgId: 'o',
      role: 'sales' as const,
      workspaceIds: [],
      resolvedAt: new Date(),
      traceId: TRACE,
    };
    runWithRequestContext(ctx, () => new ProblemFilter().catch(new Error('boom'), host as never));
    expect(JSON.parse(String(res.end.mock.calls[0]?.[0]))).toMatchObject({
      code: 'internal_error',
      traceId: TRACE,
    });
  });
});

describe('codeOfStatus (Brief P9, N132)', () => {
  it('gives the code of P9 for a status it names, and the status name in snake_case otherwise', () => {
    expect([400, 401, 403, 404, 413, 429, 500].map(codeOfStatus)).toEqual([
      'validation_failed',
      'unauthorized',
      'forbidden',
      'not_found',
      'payload_too_large',
      'rate_limited',
      'internal_error',
    ]);
    expect([405, 409, 503, 599].map(codeOfStatus)).toEqual([
      'method_not_allowed',
      'conflict',
      'service_unavailable',
      'error',
    ]);
  });
});
