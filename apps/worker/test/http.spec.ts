import { describe, expect, it } from 'vitest';

import { statusCounts, writeEvents } from './db.js';
import { spawnWorker, waitFor, workerEnv } from './harness.js';
import { useQueueSuite } from './suite.js';

// Review OPS-02: the real worker serves /healthz and /metrics on the port it logs, and stops serving them when it shuts down.
const suite = useQueueSuite();

const value = (text: string, name: string) =>
  Number(new RegExp(`^${name} (\\S+)$`, 'm').exec(text)?.[1]);

describe('the HTTP endpoints of the worker process', () => {
  it('answers /healthz and counts its passes on /metrics while it relays, and closes them on SIGTERM', async () => {
    const org = await suite.newOrg();
    const written = await writeEvents(suite.app, org, 10);
    const worker = spawnWorker('dist/main.js', workerEnv());
    const listening = await worker.waitLog('worker_http_listening', { timeoutMs: 15_000 });
    const base = `http://127.0.0.1:${Number(listening.port)}`;
    await waitFor(async () => (await statusCounts(suite.admin, org)).published === written.length, {
      timeoutMs: 30_000,
      label: 'the relay to publish the 10 events',
    });

    const health = await fetch(`${base}/healthz`);
    expect([health.status, await health.text()]).toEqual([200, '{"status":"ok"}']);
    const metrics = await fetch(`${base}/metrics`);
    const text = await metrics.text();
    expect(metrics.status).toBe(200);
    expect(value(text, 'outbox_relay_passes_total')).toBeGreaterThan(0);
    expect(value(text, 'outbox_publish_failures_total')).toBe(0);
    expect(text).not.toContain(org);
    // The state of the outbox, read from the database at the scrape (N118); other tests may have left events of their own.
    expect(value(text, 'outbox_stats_up')).toBe(1);
    expect(value(text, 'outbox_pending')).toBeGreaterThanOrEqual(0);

    worker.signal('SIGTERM');
    expect(await worker.waitExit(12_000)).toEqual({ code: 0, signal: null });
    await expect(fetch(`${base}/healthz`)).rejects.toThrow();
  });
});
