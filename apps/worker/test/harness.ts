import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { Redis } from 'ioredis';

const exec = promisify(execFile);
const workerDir = resolve(import.meta.dirname, '..');

/** An environment variable the test needs. A missing one is an error, never a skipped test. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: integration tests need Valkey (see the queue job of CI)`);
  return value;
}

export interface WaitOptions {
  readonly timeoutMs: number;
  /** What is waited for: it goes into the failure message. */
  readonly label: string;
  readonly everyMs?: number;
  /** Add the state given by `reportOnTimeout` to the failure message (default true). */
  readonly report?: boolean;
}

let reporter: (() => Promise<string>) | undefined;

/**
 * What every `waitFor` that runs out of time adds to its message: the state of the test (the outbox rows, the worker logs). A test
 * that goes red must carry the evidence to classify the failure; this is for diagnosis only and changes no deadline.
 */
export function reportOnTimeout(report: (() => Promise<string>) | undefined): void {
  reporter = report;
}

async function stateAtDeadline(options: WaitOptions): Promise<string> {
  if (options.report === false || !reporter) return '';
  try {
    return `\n--- state at the deadline ---\n${await reporter()}`;
  } catch (error) {
    return `\n--- state at the deadline: not available (${error instanceof Error ? error.message : String(error)}) ---`;
  }
}

/**
 * Asks `probe` until it gives a value (anything but `false`, `undefined` or `null`) and returns it. A probe that throws is asked
 * again. At the deadline it fails with what it was waiting for and the last thing seen: a run that goes red must say why, and the
 * deadline is never lengthened to get a green one.
 */
export async function waitFor<T>(
  probe: () => Promise<T | false | undefined | null>,
  options: WaitOptions,
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  let last = 'the condition was not met';
  for (;;) {
    try {
      const value = await probe();
      if (value !== false && value !== undefined && value !== null) return value;
    } catch (error) {
      last = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    if (Date.now() >= deadline)
      throw new Error(
        `timed out after ${options.timeoutMs} ms waiting for ${options.label} (last: ${last})${await stateAtDeadline(options)}`,
      );
    await new Promise((resolve) => setTimeout(resolve, options.everyMs ?? 200));
  }
}

/** Stops or starts the Valkey container of the job (`docker run --name`): the one thing a test does to the server. */
export async function valkey(action: 'stop' | 'start'): Promise<void> {
  await exec('docker', [action, requireEnv('VALKEY_CONTAINER')], { timeout: 60_000 });
}

/** What Docker says about the Valkey container (`running`, `exited`, ...), for the state a failure reports. */
export async function valkeyStatus(): Promise<string> {
  try {
    const { stdout } = await exec(
      'docker',
      ['inspect', '--format', '{{.State.Status}}', requireEnv('VALKEY_CONTAINER')],
      { timeout: 20_000 },
    );
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

/** Starts Valkey if a test left it stopped, and waits until it answers: one test must not poison the next. */
export async function restoreValkey(redisUrl: string): Promise<void> {
  await valkey('start').catch(() => undefined);
  const probe = new Redis(redisUrl, { maxRetriesPerRequest: 1, retryStrategy: () => 100 });
  probe.on('error', () => undefined);
  try {
    await waitFor(async () => (await probe.ping()) === 'PONG', {
      timeoutMs: 60_000,
      label: 'Valkey to answer again',
    });
  } finally {
    probe.disconnect();
  }
}

type LogLine = Readonly<Record<string, unknown>>;
export interface Exit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** A worker process of the test: what it printed, how it ended, and the signals that can be sent to it. */
export interface WorkerProcess {
  /** The lines of the log of the process that are JSON, in order. */
  logs(message: string): LogLine[];
  /** Waits for a log line with this message (and, when given, for which `where` is true); fails with the end of the log. */
  waitLog(
    message: string,
    options: { timeoutMs: number; where?: (line: LogLine) => boolean },
  ): Promise<LogLine>;
  /** Waits for the process to end, and says how. */
  waitExit(timeoutMs: number): Promise<Exit>;
  signal(signal: NodeJS.Signals): void;
  /** The last lines of everything it printed (stdout and stderr), for the message of a failure. */
  tail(count?: number): string;
}

const isLine = (value: unknown): value is LogLine => typeof value === 'object' && value !== null;

const running = new Set<ChildProcess>();
const spawned: { readonly entry: string; readonly tail: (count?: number) => string }[] = [];

/** The end of the log of every worker this test started, for the state a failure reports. */
export function workerTails(count = 40): string {
  if (spawned.length === 0) return 'no worker was started';
  return spawned
    .map(
      (w) =>
        `--- worker ${w.entry}: last ${count} lines ---\n${w.tail(count) || '(it printed nothing)'}`,
    )
    .join('\n');
}

/**
 * Starts the worker as a real process, from `apps/worker`: `entry` is a path relative to it (`dist/main.js`, or the crash entry of
 * the tests). The settings are the ones a deployment gives; the tests only shorten the waits. The database URL of the administrator
 * is not passed on: the worker has the `app_role` one only.
 */
export function spawnWorker(entry: string, env: Readonly<Record<string, string>>): WorkerProcess {
  const lines: string[] = [];
  const childEnv: Record<string, string | undefined> = { ...process.env, ...env };
  delete childEnv.DATABASE_URL_MIGRATION;
  delete childEnv.DATABASE_URL_AUTH;
  const child = spawn(process.execPath, [entry], { cwd: workerDir, env: childEnv });
  running.add(child);
  const exit = new Promise<Exit>((resolveExit) => {
    child.once('exit', (code, signal) => {
      running.delete(child);
      resolveExit({ code, signal });
    });
  });
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      const parts = (rest + chunk).split('\n');
      rest = parts.pop() ?? '';
      lines.push(...parts);
    });
  }
  const parsed = (): LogLine[] =>
    lines.flatMap((line) => {
      try {
        const value: unknown = JSON.parse(line);
        return isLine(value) ? [value] : [];
      } catch {
        return [];
      }
    });
  const tail = (count = 40): string => lines.slice(-count).join('\n');
  spawned.push({ entry, tail });
  return {
    logs: (message) => parsed().filter((line) => line.message === message),
    async waitLog(message, options) {
      const label = `the worker to log "${message}"`;
      try {
        return await waitFor(
          () =>
            Promise.resolve(
              parsed().find((l) => l.message === message && (options.where?.(l) ?? true)),
            ),
          { timeoutMs: options.timeoutMs, label, report: false },
        );
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\n--- end of the log of the worker ---\n${tail()}`,
          { cause: error },
        );
      }
    },
    async waitExit(timeoutMs) {
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `the worker did not end in ${timeoutMs} ms\n--- end of the log of the worker ---\n${tail()}`,
              ),
            ),
          timeoutMs,
        );
      });
      try {
        return await Promise.race([exit, late]);
      } finally {
        clearTimeout(timer);
      }
    },
    signal: (signal) => void child.kill(signal),
    tail,
  };
}

/** Ends every worker a test left alive; called after each test, whatever its result. */
export async function killWorkers(): Promise<void> {
  for (const child of running) child.kill('SIGKILL');
  await waitFor(() => Promise.resolve(running.size === 0), {
    timeoutMs: 10_000,
    label: 'the worker processes to end',
    report: false,
  });
  spawned.splice(0);
}

/** The settings of a worker in a test: the waits are short, everything else is what a deployment has. */
export function workerEnv(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    DATABASE_URL_APP: requireEnv('DATABASE_URL_APP'),
    REDIS_URL: requireEnv('REDIS_URL'),
    OUTBOX_POLL_MS: '100',
    OUTBOX_LEASE_S: '5',
    OUTBOX_SHUTDOWN_MS: '5000',
    // The kill-tests of the relay consume its queues with their own consumer: the worker's would take jobs from it. A test of the
    // consumer turns it on (EVENTS_CONSUMER_ENABLED: '1').
    EVENTS_CONSUMER_ENABLED: '0',
    // A free port each time: K2 and K3 start a worker right after another one.
    WORKER_HTTP_PORT: '0',
    ...extra,
  };
}
