// Rule 5 of CLAUDE.md, no PII in a log, at the two formatters of the backend (the Nest logger of the API, the JSON logger of the
// worker) and in the crash handlers of both: one implementation for both processes. A log line keeps its words, ids and codes; what
// looks like an email, a phone number or a Zalo user id, and the query of a URL, is replaced.

const EMAIL = /[\w.%+-]+@[\w-]*[a-z][\w-]*(?:\.[\w-]+)+/gi;
// Six digits or more, one space, dot or dash at most between two: phone numbers (0912 345 678, +84912345678) and Zalo user ids.
// Never a run inside a word or right after a dash, so uuids, trace ids, ISO times and versions stay readable (an IPv4 is masked).
const NUMBER = /(?<![\w-])\+?\d(?:[ .-]?\d){5,}(?![\w-])/g;
const QUERY = /(\bhttps?:\/\/[^\s?#"']*)\?[^\s#"']*/g;

/** The text with what looks like PII replaced by `<email>`, `<number>` and `?<query>`. */
export function redactPii(text: string): string {
  return text.replace(QUERY, '$1?<query>').replace(EMAIL, '<email>').replace(NUMBER, '<number>');
}

/**
 * An error as one safe line: its name, its code and its message, redacted. Never its other fields: the `detail` of a PostgreSQL error
 * carries the values of the row ("Key (phone_e164)=(+84…)", "Failing row contains (…)"), and so may `where` or `parameters`.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return `non-error value thrown (${typeof error})`;
  const code = (error as { code?: unknown }).code;
  const frames = (error.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line));
  return redactPii(
    [
      `${error.name}${typeof code === 'string' ? ` ${code}` : ''}: ${error.message}`,
      ...frames,
    ].join('\n'),
  );
}

/**
 * Replaces what Node prints on a crash (the whole error object, its `detail` included) with `describeError`, then ends the process with
 * exit code 1. Called first thing by the main of the API and of the worker.
 */
export function installCrashHandlers(
  write: (line: string) => void = (line) => void process.stderr.write(`${line}\n`),
): void {
  for (const event of ['uncaughtException', 'unhandledRejection'] as const)
    process.on(event, (error: unknown) => {
      write(`${event}: ${describeError(error)}`);
      process.exit(1);
    });
}
