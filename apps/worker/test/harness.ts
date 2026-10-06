import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

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
        `timed out after ${options.timeoutMs} ms waiting for ${options.label} (last: ${last})`,
      );
    await new Promise((resolve) => setTimeout(resolve, options.everyMs ?? 200));
  }
}

/** Stops or starts the Valkey container of the job (`docker run --name`): the one thing a test does to the server. */
export async function valkey(action: 'stop' | 'start'): Promise<void> {
  await exec('docker', [action, requireEnv('VALKEY_CONTAINER')], { timeout: 60_000 });
}
