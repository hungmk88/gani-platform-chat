import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { startHttp, type WorkerHttp } from './http.js';
import { WorkerMetrics } from './metrics.js';

let open: WorkerHttp[] = [];
afterEach(async () => {
  await Promise.all(open.map((h) => h.close()));
  open = [];
});

async function serve(now: () => number = Date.now) {
  const metrics = new WorkerMetrics(now);
  const http = await startHttp({ port: 0, metrics, healthMaxAgeMs: 1000 });
  open.push(http);
  const get = async (path: string, method = 'GET') => {
    const res = await fetch(`http://127.0.0.1:${http.port}${path}`, { method });
    return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
  };
  return { metrics, http, get };
}

describe('the HTTP endpoints of the worker', () => {
  it('answers /healthz 200 while the relay ends passes, 503 when it stopped, without a reason', async () => {
    let now = 0;
    const s = await serve(() => now);
    expect(await s.get('/healthz')).toEqual({
      status: 200,
      type: 'application/json',
      body: '{"status":"ok"}',
    });
    now = 5000;
    expect(await s.get('/healthz')).toEqual({
      status: 503,
      type: 'application/json',
      body: '{"status":"unavailable"}',
    });
    s.metrics.passEnded(true);
    expect((await s.get('/healthz?probe=1')).status).toBe(200);
  });

  it('serves the counters on /metrics in the Prometheus text format', async () => {
    const s = await serve();
    s.metrics.publishFailed(2);
    const res = await s.get('/metrics');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(res.body).toContain('\noutbox_publish_failures_total 2\n');
  });

  it('answers 404 for another path and 405 for another method', async () => {
    const s = await serve();
    expect((await s.get('/')).status).toBe(404);
    expect((await s.get('/healthz', 'POST')).status).toBe(405);
  });

  it('refuses to start when the port is taken, and closes cleanly', async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, resolve));
    const port = (taken.address() as AddressInfo).port;
    try {
      await expect(
        startHttp({ port, metrics: new WorkerMetrics(), healthMaxAgeMs: 1000 }),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await new Promise((resolve) => taken.close(resolve));
    }
    const s = await serve();
    await s.http.close();
    open = [];
    await expect(fetch(`http://127.0.0.1:${s.http.port}/healthz`)).rejects.toThrow();
  });
});
