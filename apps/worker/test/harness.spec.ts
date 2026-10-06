import { afterEach, describe, expect, it } from 'vitest';

import { killWorkers, reportOnTimeout, spawnWorker, waitFor, workerTails } from './harness.js';

// The harness itself: a test that goes red must carry the evidence to classify the failure (the first red of K1b did not). These
// need neither Valkey nor PostgreSQL, so they also run on a machine without Docker (after `pnpm --filter @gani/worker build`).
afterEach(async () => {
  reportOnTimeout(undefined);
  await killWorkers();
});

describe('waitFor', () => {
  it('says what it waited for, how long, and the state the test reports, when it runs out of time', async () => {
    reportOnTimeout(() => Promise.resolve('org o-1: pending=3'));
    const failure: unknown = await waitFor(() => Promise.resolve(false), {
      timeoutMs: 50,
      everyMs: 10,
      label: 'something that never happens',
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      'timed out after 50 ms waiting for something that never happens',
    );
    expect((failure as Error).message).toContain('--- state at the deadline ---');
    expect((failure as Error).message).toContain('org o-1: pending=3');
  });

  it('still fails with its own message when the report itself fails, and adds nothing when asked not to', async () => {
    reportOnTimeout(() => Promise.reject(new Error('the database is gone')));
    const options = { timeoutMs: 30, everyMs: 10, label: 'x' };
    const broken = await waitFor(() => Promise.resolve(false), options).catch(
      (e: Error) => e.message,
    );
    expect(broken).toContain('timed out after 30 ms waiting for x');
    expect(broken).toContain('not available (the database is gone)');
    const quiet = await waitFor(() => Promise.resolve(false), { ...options, report: false }).catch(
      (e: Error) => e.message,
    );
    expect(quiet).not.toContain('state at the deadline');
  });

  it('returns the value as soon as the probe gives one, and asks again after a probe that throws', async () => {
    let calls = 0;
    const value = await waitFor(
      () => {
        calls++;
        return calls < 3 ? Promise.reject(new Error('not yet')) : Promise.resolve('ready');
      },
      { timeoutMs: 1000, everyMs: 5, label: 'a probe' },
    );
    expect(value).toBe('ready');
  });
});

describe('spawnWorker', () => {
  it('keeps what the process printed, says how it ended, and puts the end of its log in the state a failure reports', async () => {
    // With no database and no queue URL the worker stops at once with a message that names the variables.
    const worker = spawnWorker('dist/main.js', { DATABASE_URL_APP: '', REDIS_URL: '' });
    const ended = await worker.waitExit(20_000);
    expect(ended).toEqual({ code: 1, signal: null });
    expect(worker.tail()).toContain('DATABASE_URL_APP is not set');
    expect(workerTails()).toContain('worker dist/main.js');
    expect(workerTails()).toContain('DATABASE_URL_APP is not set');
    await expect(worker.waitLog('worker_started', { timeoutMs: 100 })).rejects.toThrow(
      /worker_started[\s\S]*DATABASE_URL_APP is not set/,
    );
  });
});
