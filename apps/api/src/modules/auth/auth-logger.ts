import { Logger } from '@nestjs/common';

// Review SEC-01: where Better Auth's own messages go. A message of the library is kept, its arguments (an error object, a request body)
// never are, and a message that carries a query is replaced. The errors themselves are already cleaned by safeErrorsAdapter; this is the
// second net. Its own file so that auth.config.ts only names it (the options `logger` and `onAPIError`).

export const authLogger = new Logger('BetterAuth');

const QUERY_TEXT = /failed query|params:|\bselect\b|\binsert\b|\bupdate\b/i;

export function logAuthMessage(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  const text = QUERY_TEXT.test(message) ? 'database error' : message;
  if (level === 'error') authLogger.error(text);
  else if (level === 'warn') authLogger.warn(text);
  else authLogger.log(text);
}
