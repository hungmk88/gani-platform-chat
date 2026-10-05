import { randomUUID } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TWO_FACTOR_SETUP_ROUTES } from '../auth/two-factor.js';
import { PROBLEM_CONTENT_TYPE } from './problem.js';
import type { ResolvedSession } from './session-resolver.js';
import { createTwoFactorGate, type TwoFactorGateDeps } from './two-factor.gate.js';

// The gate on a plain HTTP server with stub dependencies. Every path is sent exactly as written (http.request with options):
// fetch and `new URL` normalise dot segments on the client, which would test the client instead of the gate.
const USER: string = randomUUID();
const session: ResolvedSession = {
  userId: USER,
  sessionId: randomUUID(),
  activeOrgId: null,
  resolvedAt: new Date(),
};

let server: Server | undefined;
async function stop(): Promise<void> {
  const running = server;
  server = undefined;
  if (!running) return;
  running.closeAllConnections();
  await new Promise((done) => running.close(done));
}
afterEach(stop);

async function start(deps: Partial<TwoFactorGateDeps>) {
  await stop();
  const gate = createTwoFactorGate({
    sessions: { resolve: () => Promise.resolve(session) },
    mustSetUp: () => Promise.resolve(true),
    ...deps,
  });
  server = createServer((req, res) => {
    void gate(req, res, () => res.end('passed'));
  });
  await new Promise<void>((ready) => server?.listen(0, '127.0.0.1', ready));
  const port = (server?.address() as AddressInfo).port;
  return (path: string, method = 'POST') =>
    new Promise<{ status: number; type: string; body: string }>((done, fail) => {
      const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () =>
          done({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), body }),
        );
      });
      req.on('error', fail).end();
    });
}

// What a person who has to set up a second factor may do: the routes of TWO_FACTOR_SETUP_ROUTES, /v1/me/security-status in any
// letter case, and what normalises to one of them.
const OPEN = [
  ...TWO_FACTOR_SETUP_ROUTES.map((route) => `/api/auth${route}`),
  '/api/auth/./two-factor/enable',
  '/api/auth/two-factor/../two-factor/enable',
  '/api/auth/two-factor/enable?x=1',
  '/v1/me/security-status',
  '/V1/me/security-status',
  '/v1/ME/SECURITY-STATUS',
  '/v1/me/security-status?a=1',
  '/healthz',
  '/readyz',
];
// Everything else, among them the ways to reach another route through an open one.
const CLOSED = [
  '/api/auth/two-factor/enable/../../list-sessions',
  '/api/auth/two-factor/enable/%2e%2e/%2e%2e/list-sessions',
  '/api/auth/two-factor/%2e%2e/list-sessions',
  '/api/auth/list-sessions',
  '/api/auth/get-session',
  '/api/auth/switch-org',
  '/api/auth/two-factor/disable',
  '/api/auth/two-factor/enable/',
  '/api/auth/two-factor/enablex',
  '/api/auth/Two-Factor/enable',
  '/api/auth/',
  '/api/auth',
  '/api/authx/two-factor/enable',
  '/v1/test/protected',
  '/v1/me/security-status/',
  '/v1/me/security-status/x',
  '/v1/me/security-statusx',
  '/v1/me',
  '/other',
  '/',
];

describe('two-factor gate', () => {
  it('lets the routes of the set-up through for a person who has to set up and has not', async () => {
    const get = await start({});
    for (const path of OPEN) expect((await get(path)).status, path).toBe(200);
  });

  it('refuses every other path with 403 TWO_FACTOR_SETUP_REQUIRED as RFC 9457', async () => {
    const get = await start({});
    for (const path of CLOSED) {
      const answer = await get(path);
      expect(answer.status, path).toBe(403);
      expect(answer.type, path).toBe(PROBLEM_CONTENT_TYPE);
      expect(JSON.parse(answer.body), path).toMatchObject({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        code: 'TWO_FACTOR_SETUP_REQUIRED',
        detail: expect.any(String) as string,
        traceId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      });
    }
  });

  it('refuses, whatever the method, a path it would let through with another', async () => {
    const get = await start({});
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      expect((await get('/v1/test/protected', method)).status, method).toBe(403);
    }
  });

  describe('control: the same paths for people the rule does not hold back', () => {
    it('does not block a person who is not required to use a second factor, or who already has one', async () => {
      const get = await start({ mustSetUp: () => Promise.resolve(false) });
      for (const path of [...OPEN, ...CLOSED]) expect((await get(path)).status, path).toBe(200);
    });

    it('does not block a request without a session, and does not ask the database about it', async () => {
      const mustSetUp = vi.fn(() => Promise.resolve(true));
      const get = await start({ sessions: { resolve: () => Promise.resolve(null) }, mustSetUp });
      for (const path of [...OPEN, ...CLOSED]) expect((await get(path)).status, path).toBe(200);
      expect(mustSetUp).not.toHaveBeenCalled();
    });
  });

  it('asks about the person on every request and only once per request', async () => {
    const mustSetUp = vi.fn(() => Promise.resolve(false));
    const get = await start({ mustSetUp });
    await get('/v1/x');
    await get('/v1/x');
    expect(mustSetUp).toHaveBeenCalledTimes(2);
    expect(mustSetUp).toHaveBeenCalledWith(USER);
  });

  it('leaves the probes alone: no session lookup, no database', async () => {
    const resolve = vi.fn(() => Promise.reject(new Error('down')));
    const get = await start({ sessions: { resolve } });
    expect((await get('/healthz', 'GET')).status).toBe(200);
    expect((await get('/READYZ', 'GET')).status).toBe(200);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses with 503, and no cause, when the session or the rule cannot be read', async () => {
    const leak = 'connection refused to db-7.internal:5432 password=hunter2';
    const failing: Partial<TwoFactorGateDeps>[] = [
      { sessions: { resolve: () => Promise.reject(new Error(leak)) } },
      { mustSetUp: () => Promise.reject(new Error(leak)) },
    ];
    for (const deps of failing) {
      const get = await start(deps);
      const answer = await get('/api/auth/two-factor/enable');
      expect(answer.status).toBe(503);
      expect(answer.type).toBe(PROBLEM_CONTENT_TYPE);
      expect(JSON.parse(answer.body)).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
      expect(answer.body).not.toMatch(/hunter2|db-7|refused/);
    }
  });
});
