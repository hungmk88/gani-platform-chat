import { inspect } from 'node:util';

import { describeError, redactPii } from '@gani/domain';
import { ConsoleLogger, type LogLevel } from '@nestjs/common';

/**
 * The one logger of the API (CLAUDE.md rule 5): main.ts installs it before Nest starts, so every `Logger` of the application, an
 * instance (`new Logger(ctx)`, Better Auth's `authLogger`) or the static methods, writes through it. Every level of ConsoleLogger
 * ends in printMessages (its extra fields in stringifyParams), and `error` also prints a stack through printStackTrace: all three are
 * redacted with `redactPii` of @gani/domain, the same function as the worker's. An Error is printed by `describeError`, so never with
 * the `detail` of a PostgreSQL error.
 */
export class RedactingLogger extends ConsoleLogger {
  protected override printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, unknown>,
  ): void {
    super.printMessages(
      messages.map((message) =>
        safe(typeof message === 'function' ? (message as () => unknown)() : message),
      ),
      context,
      logLevel,
      writeStreamType,
      errorStack,
      params,
    );
  }

  protected override stringifyParams(params: Record<string, unknown>): string {
    return redactPii(super.stringifyParams(params));
  }

  protected override printStackTrace(stack: string): void {
    super.printStackTrace(stack && redactPii(stack));
  }
}

function safe(message: unknown): string {
  if (typeof message === 'string') return redactPii(message);
  if (message instanceof Error) return describeError(message);
  return redactPii(inspect(message, { depth: 3, breakLength: Infinity }));
}
