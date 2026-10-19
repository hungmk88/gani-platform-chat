import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { WorkerMetrics } from './metrics.js';

export interface WorkerHttp {
  /** The port it listens on (the one the system picked when asked for 0). */
  readonly port: number;
  close(): Promise<void>;
}

const JSON_TYPE = 'application/json';
const METRICS_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/**
 * The worker's HTTP endpoints (review OPS-02), on `node:http` and nothing else:
 *   GET /healthz  200 {"status":"ok"}, or 503 {"status":"unavailable"} when the relay has not ended a pass for `healthMaxAgeMs`
 *   GET /metrics  the counters, for Prometheus
 * Anything else is 404 (405 for another method on a known path). No body names a reason, a tenant or a setting.
 * Resolves once it listens; rejects when it cannot (a port in use), so the worker does not run without its probes.
 */
export function startHttp(options: {
  readonly port: number;
  readonly metrics: WorkerMetrics;
  readonly healthMaxAgeMs: number;
}): Promise<WorkerHttp> {
  const { metrics, healthMaxAgeMs } = options;
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/healthz' && path !== '/metrics') {
      res.writeHead(404, { 'content-type': JSON_TYPE }).end('{"status":"not_found"}');
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET', 'content-type': JSON_TYPE }).end();
      return;
    }
    if (path === '/metrics') {
      res.writeHead(200, { 'content-type': METRICS_TYPE }).end(metrics.render());
      return;
    }
    const ok = metrics.healthy(healthMaxAgeMs);
    res
      .writeHead(ok ? 200 : 503, { 'content-type': JSON_TYPE })
      .end(ok ? '{"status":"ok"}' : '{"status":"unavailable"}');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, () => {
      server.off('error', reject);
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
