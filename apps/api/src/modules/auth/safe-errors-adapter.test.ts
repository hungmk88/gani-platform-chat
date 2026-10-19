import { randomBytes } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { APIError } from 'better-auth/api';
import type { DBAdapter } from 'better-auth/adapters';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { logAuthMessage } from './auth-logger.js';
import {
  AuthStoreError,
  cleanStoreError,
  safeErrorsAdapter,
  safeQueryPool,
  storeErrorCode,
  type QueryPool,
} from './safe-errors-adapter.js';

// Review SEC-01: what a DrizzleQueryError looks like (drizzle-orm 0.45): the SQL and the parameters in the message and as properties,
// the driver error (with its SQLSTATE) as the cause.
const SECRET_EMAIL = 'someone.secret@example.test';
const SECRET_TOKEN = randomBytes(12).toString('hex'); // made at each run: no fixed value that looks like a credential
function drizzleError(): Error {
  const cause = Object.assign(new Error('permission denied for table sessions'), { code: '42501' });
  return Object.assign(
    new Error(
      `Failed query: select * from "sessions" where "token" = $1\nparams: ${SECRET_TOKEN}`,
      {
        cause,
      },
    ),
    {
      name: 'DrizzleQueryError',
      query: 'select * from "sessions" where "token" = $1',
      params: [SECRET_TOKEN, SECRET_EMAIL],
    },
  );
}
/** Everything a log line could print of an error: message, stack, own properties, and the same for its cause. */
const printable = (error: unknown): string => {
  const cause = (error as { cause?: unknown }).cause;
  return (
    JSON.stringify(error, Object.getOwnPropertyNames(error)) +
    String((error as Error).stack) +
    (cause === undefined ? '' : JSON.stringify(cause, Object.getOwnPropertyNames(cause)))
  );
};
/** The rejection of `promise`, as a value. */
const rejection = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cleanStoreError', () => {
  it('keeps only the SQLSTATE of a DrizzleQueryError: no SQL, no parameter, no cause', () => {
    const clean = cleanStoreError(drizzleError());
    expect(clean).toBeInstanceOf(AuthStoreError);
    expect((clean as AuthStoreError).code).toBe('42501');
    expect((clean as Error).message).toBe('auth store failed (42501)');
    const text = printable(clean);
    for (const secret of [SECRET_TOKEN, SECRET_EMAIL, 'Failed query', 'sessions']) {
      expect(text).not.toContain(secret);
    }
    expect((clean as { cause?: unknown }).cause).toBeUndefined();
  });

  it('keeps a system code (ECONNREFUSED) and says unknown when there is none', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {
      code: 'ECONNREFUSED',
    });
    expect(storeErrorCode(refused)).toBe('ECONNREFUSED');
    expect((cleanStoreError(refused) as Error).message).not.toContain('10.0.0.5');
    expect(storeErrorCode(new Error('no code at all'))).toBe('unknown');
    expect(storeErrorCode({ code: 'not a code: drop table' })).toBe('unknown');
  });

  it('lets an APIError and an already clean error through as they are', () => {
    const api = APIError.from('UNAUTHORIZED', { code: 'SESSION_CHANGED', message: 'x' });
    expect(cleanStoreError(api)).toBe(api);
    const clean = new AuthStoreError('57014');
    expect(cleanStoreError(clean)).toBe(clean);
  });
});

describe('safeErrorsAdapter', () => {
  function adapterThatFails() {
    const inner = {
      id: 'fake',
      findOne: vi.fn(() => Promise.reject(drizzleError())),
      create: vi.fn(() => Promise.resolve({ id: '1' })),
      transaction: vi.fn((cb: (trx: unknown) => Promise<unknown>) => cb(inner)),
    };
    const adapter = safeErrorsAdapter(() => inner as unknown as DBAdapter)({});
    return { inner, adapter };
  }

  it('turns a failed call into a code-only error, and leaves a good one alone', async () => {
    const { adapter } = adapterThatFails();
    const error = await rejection(adapter.findOne({ model: 'session', where: [] }));
    expect(error).toBeInstanceOf(AuthStoreError);
    expect(printable(error)).not.toContain(SECRET_TOKEN);
    expect(await adapter.create({ model: 'user', data: {} })).toEqual({ id: '1' });
    expect(adapter.id).toBe('fake');
  });

  it('cleans inside a transaction, and lets an APIError thrown by the callback out unchanged', async () => {
    const { adapter } = adapterThatFails();
    const inside = await rejection(
      adapter.transaction((trx) => trx.findOne({ model: 'session', where: [] })),
    );
    expect(inside).toBeInstanceOf(AuthStoreError);
    const api = APIError.from('UNAUTHORIZED', { code: 'SESSION_CHANGED', message: 'x' });
    await expect(adapter.transaction(() => Promise.reject(api))).rejects.toBe(api);
  });

  it('cleans an error thrown before a promise is returned, as a rejected promise', async () => {
    const inner = {
      findOne: vi.fn(() => {
        throw drizzleError();
      }),
    };
    const adapter = safeErrorsAdapter(() => inner as unknown as DBAdapter)({});
    const error = await rejection(adapter.findOne({ model: 'session', where: [] }));
    expect(error).toBeInstanceOf(AuthStoreError);
    expect(printable(error)).not.toContain(SECRET_TOKEN);
  });
});

describe('safeQueryPool', () => {
  it('cleans a failed raw query and passes a good one through', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(drizzleError())
      .mockResolvedValueOnce({ rows: [{ ok: true }] });
    const pool = safeQueryPool({ query } as QueryPool);
    const error = await rejection(pool.query('SELECT 1', []));
    expect(error).toBeInstanceOf(AuthStoreError);
    expect(printable(error)).not.toContain(SECRET_EMAIL);
    expect(await pool.query('SELECT 1', [])).toEqual({ rows: [{ ok: true }] });
    const throwing = safeQueryPool({
      query: () => {
        throw drizzleError();
      },
    });
    expect(await rejection(throwing.query('SELECT 1', []))).toBeInstanceOf(AuthStoreError);
  });
});

describe('logAuthMessage', () => {
  it('prints the message of the library, never a query, at the right level', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    logAuthMessage('error', `Failed query: select 1\nparams: ${SECRET_EMAIL}`);
    logAuthMessage('warn', 'Rate limit exceeded');
    logAuthMessage('info', 'started');
    expect(error).toHaveBeenCalledWith('database error');
    expect(warn).toHaveBeenCalledWith('Rate limit exceeded');
    expect(log).toHaveBeenCalledWith('started');
  });
});
