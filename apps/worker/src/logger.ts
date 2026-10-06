/** Only plain values: a payload, an object or a message of an error cannot be logged by mistake (outbox spec §6.3). */
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** One JSON object per line on stdout, with the ids and codes it is given and nothing else. */
export function createLogger(
  write: (line: string) => void = (line) => void process.stdout.write(`${line}\n`),
  now: () => Date = () => new Date(),
): Logger {
  const at =
    (level: string) =>
    (message: string, fields: LogFields = {}) =>
      write(JSON.stringify({ level, time: now().toISOString(), message, ...fields }));
  return { info: at('info'), warn: at('warn'), error: at('error') };
}
