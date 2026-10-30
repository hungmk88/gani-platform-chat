import { describe, expect, it, vi } from 'vitest';

import { describeError, installCrashHandlers, redactPii } from './log-safety.js';

describe('redactPii', () => {
  it('replaces emails, phone numbers in every usual form, Zalo user ids and the query of a URL', () => {
    const text = redactPii(
      'to An.Nguyen+x@example.test from 0912 345 678, +84912345678, 0912-345-678, uid 4836251958174629381 at https://evil.example/cb?email=a@b.test&p=1',
    );
    expect(text).toBe(
      'to <email> from <number>, <number>, <number>, uid <number> at https://evil.example/cb?<query>',
    );
  });

  it('keeps what a log needs: uuids, trace ids, ISO times, short numbers, codes and package versions', () => {
    const line =
      'request failed (QueryFailedError, 23505) trace=019a2b3c-4d5e-7f60-8123-456789012345 at 2026-10-30T14:05:02.123Z port 3000 p95=9.5ms in .pnpm/pg-pool@3.13.0_pg@8.23.1/index.js:45:11';
    expect(redactPii(line)).toBe(line);
  });
});

describe('describeError', () => {
  it('keeps the name, the code and the message, and never the detail of a PostgreSQL error', () => {
    const error = Object.assign(
      new Error(
        'new row for relation "customers" violates check constraint "customers_phone_e164_check"',
      ),
      { code: '23514', detail: 'Failing row contains (0912345678, an@example.test).' },
    );
    const line = describeError(error);
    expect(line.split('\n')[0]).toBe(
      'Error 23514: new row for relation "customers" violates check constraint "customers_phone_e164_check"',
    );
    expect(line).not.toMatch(/0912345678|an@example\.test|Failing row/);
  });

  it('redacts PII in the message and the stack, and says what was thrown when it is not an error', () => {
    expect(describeError(new TypeError('no customer an@example.test'))).toMatch(
      /^TypeError: no customer <email>\n\s+at /,
    );
    expect(describeError('0912345678')).toBe('non-error value thrown (string)');
  });
});

describe('installCrashHandlers', () => {
  it('on both events writes the event and describeError, never the detail, then exits with 1', () => {
    const handlers = new Map<string, (error: unknown) => void>();
    vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (error: unknown) => void,
    ) => {
      handlers.set(event, handler);
      return process;
    }) as typeof process.on);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const lines: string[] = [];
    installCrashHandlers((line) => lines.push(line));
    const error = Object.assign(new Error('violates check constraint'), {
      code: '23514',
      detail: 'Failing row contains (0912345678).',
    });
    for (const event of ['uncaughtException', 'unhandledRejection']) handlers.get(event)?.(error);
    vi.restoreAllMocks();
    expect(lines.map((line) => line.split('\n')[0])).toEqual([
      'uncaughtException: Error 23514: violates check constraint',
      'unhandledRejection: Error 23514: violates check constraint',
    ]);
    expect(lines.join()).not.toContain('Failing row');
    expect(exit.mock.calls).toEqual([[1], [1]]);
  });
});
