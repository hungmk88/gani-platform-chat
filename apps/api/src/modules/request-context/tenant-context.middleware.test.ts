import { randomInt, randomUUID } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { currentTenantContext, type MemberContext } from '@gani/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PROBLEM_CONTENT_TYPE } from './problem.js';
import { currentRequestContext, RequestContextMissingError } from './request-context.js';
import type { ResolvedSession } from './session-resolver.js';
import {
  createTenantContextMiddleware,
  type TenantMiddlewareDeps,
} from './tenant-context.middleware.js';

// The middleware on a plain HTTP server with stub dependencies: no Nest, no database. The Postgres version over HTTP is 6d-2b-2.
const ORG_A: string = randomUUID();
const ORG_B: string = randomUUID();
const ME: string = randomUUID();
const sales: MemberContext = { role: 'sales', workspaceIds: [randomUUID()] };
const session = (activeOrgId: string | null, userId: string = ME): ResolvedSession => ({
  userId,
  sessionId: randomUUID(),
  activeOrgId,
  resolvedAt: new Date(),
});

let server: Server | undefined;
async function stop(): Promise<void> {
  const running = server;
  server = undefined;
  if (!running) return;
  running.closeAllConnections();
  await new Promise((done) => running.close(done));
}
afterEach(stop);

/** Starts a server whose last handler reports what it sees; returns a `get(path)` for it. */
async function start(deps: Partial<TenantMiddlewareDeps>) {
  await stop();
  const full: TenantMiddlewareDeps = {
    sessions: { resolve: () => Promise.resolve(session(ORG_A)) },
    organisations: () => Promise.resolve([]),
    member: () => Promise.resolve(sales),
    ...deps,
  };
  const middleware = createTenantContextMiddleware(full);
  server = createServer((req, res) => {
    void middleware(req, res, () => {
      const seen = (): object | string => {
        try {
          return { request: currentRequestContext(), tenant: currentTenantContext() };
        } catch (error) {
          return error instanceof RequestContextMissingError ? 'MISSING' : 'OTHER';
        }
      };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(seen()));
    });
  });
  await new Promise<void>((ready) => server?.listen(0, '127.0.0.1', ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string, init?: RequestInit) => fetch(base + path, init);
  // fetch and `new URL` normalise dot segments on the client; `raw` hands the path to http.request as options, exactly as written.
  const raw = (path: string) =>
    new Promise<number>((done, fail) => {
      const port = (server?.address() as AddressInfo).port;
      const req = request({ host: '127.0.0.1', port, path }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      });
      req.on('error', fail).end();
    });
  return Object.assign(get, { raw });
}

describe('tenant context middleware', () => {
  it('answers 401 as RFC 9457 with a trace id when there is no session', async () => {
    const get = await start({ sessions: { resolve: () => Promise.resolve(null) } });
    const res = await get('/v1/anything');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(await res.json()).toEqual({
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      code: 'unauthorized',
      detail: expect.any(String) as string,
      traceId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
    });
  });

  it('puts the organisation of the session, the role and the workspaces into both contexts', async () => {
    const organisations = vi.fn(() => Promise.resolve([ORG_B]));
    const member = vi.fn(() => Promise.resolve(sales));
    const get = await start({ organisations, member });
    const body = (await (await get('/v1/x')).json()) as {
      request: { userId: string; orgId: string; role: string; workspaceIds: string[] };
      tenant: { orgId: string; workspaceIds: string[] };
    };
    expect(body.request).toMatchObject({ userId: ME, orgId: ORG_A, role: 'sales' });
    // The traceId the error filter answers with (N132): made by the server, never taken from the request.
    expect((body.request as { traceId?: unknown }).traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.request.workspaceIds).toEqual(sales.workspaceIds);
    expect(body.tenant).toEqual({ orgId: ORG_A, workspaceIds: sales.workspaceIds });
    expect(member).toHaveBeenCalledWith(ORG_A, ME);
    expect(organisations).not.toHaveBeenCalled();
  });

  it('never takes the organisation from the request', async () => {
    const get = await start({});
    const res = await get(`/v1/x?orgId=${ORG_B}&org_id=${ORG_B}`, {
      method: 'POST',
      headers: { 'x-org-id': ORG_B, 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: ORG_B }),
    });
    const body = (await res.json()) as { request: { orgId: string } };
    expect(body.request.orgId).toBe(ORG_A);
  });

  describe('when the session has no organisation', () => {
    const noOrg = { sessions: { resolve: () => Promise.resolve(session(null)) } };

    it('uses the only active organisation', async () => {
      const member = vi.fn(() => Promise.resolve(sales));
      const get = await start({ ...noOrg, organisations: () => Promise.resolve([ORG_B]), member });
      const body = (await (await get('/v1/x')).json()) as { request: { orgId: string } };
      expect(body.request.orgId).toBe(ORG_B);
      expect(member).toHaveBeenCalledWith(ORG_B, ME);
    });

    it('is 403 org_not_selected with several', async () => {
      const get = await start({ ...noOrg, organisations: () => Promise.resolve([ORG_A, ORG_B]) });
      const res = await get('/v1/x');
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
      expect(await res.json()).toMatchObject({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        code: 'org_not_selected',
        detail: expect.any(String) as string,
        traceId: expect.any(String) as string,
      });
    });

    it('is 403 no_organisation with none, also when the only one is lost between the two questions', async () => {
      const none = await start({ ...noOrg, organisations: () => Promise.resolve([]) });
      expect(await (await none('/v1/x')).json()).toMatchObject({ code: 'no_organisation' });
      const raced = await start({
        ...noOrg,
        organisations: () => Promise.resolve([ORG_A]),
        member: () => Promise.resolve(null),
      });
      const res = await raced('/v1/x');
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'no_organisation' });
    });
  });

  it('treats an organisation the person was removed from as not chosen', async () => {
    const left = (o: string) => Promise.resolve(o === ORG_A ? null : sales);
    const one = await start({ member: left, organisations: () => Promise.resolve([ORG_B]) });
    const body = (await (await one('/v1/x')).json()) as { request: { orgId: string } };
    expect(body.request.orgId).toBe(ORG_B);
  });

  it('refuses with 403 for a removed organisation when the person has several others', async () => {
    const get = await start({
      member: () => Promise.resolve(null),
      organisations: () => Promise.resolve([ORG_A, ORG_B]),
    });
    expect(await (await get('/v1/x')).json()).toMatchObject({ code: 'org_not_selected' });
  });

  it('is 503 without the cause when a dependency fails, and 403 only for "not a member"', async () => {
    const leak = 'connection refused to db-seven.internal:5432 password=hunter2';
    const failing: Partial<TenantMiddlewareDeps>[] = [
      { member: () => Promise.reject(new Error(leak)) },
      { sessions: { resolve: () => Promise.reject(new Error(leak)) } },
      {
        sessions: { resolve: () => Promise.resolve(session(null)) },
        organisations: () => Promise.reject(new Error(leak)),
      },
    ];
    for (const deps of failing) {
      const get = await start(deps);
      const res = await get('/v1/x');
      const text = await res.text();
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
      expect(JSON.parse(text)).toMatchObject({ code: 'service_unavailable', status: 503 });
      expect(text).not.toMatch(/hunter2|db-seven|refused/);
    }
  });

  describe('the routes that work without an organisation', () => {
    it('lets the exact paths through with no session, in any letter case, with a query', async () => {
      const get = await start({ sessions: { resolve: () => Promise.resolve(null) } });
      for (const path of [
        '/v1/me/security-status',
        '/V1/me/security-status',
        '/v1/ME/SECURITY-STATUS?a=1',
        '/v1/me',
        '/V1/ME?a=1',
      ]) {
        const res = await get(path);
        expect(res.status, path).toBe(200);
        expect(await res.json(), path).toBe('MISSING');
      }
    });

    it('does not extend to any other spelling', async () => {
      const get = await start({ sessions: { resolve: () => Promise.resolve(null) } });
      for (const path of [
        '/v1/me/security-status/',
        '/v1/me/security-status/x',
        '/v1/me/security-statusx',
        '/v1/me/security-status%2f',
        '/v1/me//security-status',
        '/v1/x/../me/security-status',
        '/v1/me/',
        '/v1/me/x',
        '/v1/mex',
        '/v1//me',
        '/v1/x/../me',
      ]) {
        expect(await get.raw(path), path).toBe(401);
      }
    });
  });

  it('looks the session up once per request', async () => {
    const resolve = vi.fn(() => Promise.resolve(session(ORG_A)));
    const get = await start({ sessions: { resolve } });
    await get('/v1/x');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  // The main barrier against a leak between people: many requests of different people in flight, with random delays in every
  // dependency and in the handler, each must see only its own organisation, role and workspaces.
  it('keeps 50 interleaved requests of different people apart', async () => {
    const people = Array.from({ length: 50 }, () => ({
      id: randomUUID(),
      org: randomUUID(),
      workspace: randomUUID(),
    }));
    const byId = new Map<string, (typeof people)[number]>(people.map((p) => [p.id, p]));
    const sessions = {
      resolve: async (req: { headers: { cookie?: string } }) => {
        await sleep(randomInt(0, 10));
        return session(null, req.headers.cookie);
      },
    } as unknown as TenantMiddlewareDeps['sessions'];
    const get = await start({
      sessions,
      organisations: async (id) => {
        await sleep(randomInt(0, 10));
        return [byId.get(id)?.org ?? ''];
      },
      member: async (org, id) => {
        await sleep(randomInt(0, 10));
        const p = byId.get(id);
        return p?.org === org ? { role: 'sales', workspaceIds: [p.workspace] } : null;
      },
    });
    const answers = await Promise.all(
      people.map(async (p) => {
        await sleep(randomInt(0, 15));
        const res = await get('/v1/x', { headers: { cookie: p.id } });
        return {
          p,
          body: (await res.json()) as { request: Record<string, unknown>; tenant: object },
        };
      }),
    );
    for (const { p, body } of answers) {
      expect(body.request, p.id).toMatchObject({ userId: p.id, orgId: p.org });
      expect(body.request['workspaceIds']).toEqual([p.workspace]);
      expect(body.tenant).toEqual({ orgId: p.org, workspaceIds: [p.workspace] });
    }
    expect(() => currentRequestContext()).toThrow(RequestContextMissingError);
  });
});
