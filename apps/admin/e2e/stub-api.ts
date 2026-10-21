// A stand-in for the API (Better Auth on /api/auth, /v1) for the end-to-end tests only: the admin under test is the real build,
// started by Playwright; this answers what it asks, in the shapes of Better Auth and of src/auth.ts, src/me.ts. Never deployed.
// Each email is one case; a signed-in browser carries `e2e_session=<email>` (HttpOnly), as Better Auth carries its session cookie.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { ROLES } from '../src/nav';

export const STUB_PORT = 3000; // API_ORIGIN of the admin when it is not set (next.config.ts, src/me.server.ts)
export const GOOD = 'mat-khau-dung-e2e';
export const accountOf = (who: string) => `${who}@e2e.test`;

/** Signs in, then `GET /v1/me` is not served (U32): the shell shows the error page with this trace. */
export const NO_ME = accountOf('no-me');
export const NO_ME_TRACE = 'trace-e2e-no-me';
/** Sign-in answers 429 (rate limit) or 503 (API down), whatever the password. */
export const THROTTLED = accountOf('throttled');
export const DOWN = accountOf('down');

const COOKIE = 'e2e_session';

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
/** An error of /v1 (RFC 9457 with the `code` of the P9 table and a `traceId`). */
function problem(res: ServerResponse, status: number, code: string, traceId: string) {
  res.writeHead(status, { 'content-type': 'application/problem+json' });
  res.end(JSON.stringify({ status, code, traceId }));
}

async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sessionOf(req: IncomingMessage): string | null {
  const pair = (req.headers.cookie ?? '').split('; ').find((c) => c.startsWith(`${COOKIE}=`));
  return pair ? decodeURIComponent(pair.slice(COOKIE.length + 1)) : null;
}

/** The person of `GET /v1/me` (src/me.ts), from the part of the email before `@`: a role of src/nav.ts. */
function meOf(email: string) {
  const role = email.split('@')[0] ?? '';
  if (!(ROLES as readonly string[]).includes(role)) return null;
  const operator = role === 'platform_operator';
  return {
    id: `user-${role}`,
    name: `Người thử ${role}`,
    isPlatformOperator: operator,
    org: operator ? null : { id: 'org-e2e', name: 'Công ty thử', role },
    workspaces: operator ? [] : [{ id: 'ws-e2e', name: 'Workspace thử' }],
  };
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? '/').split('?')[0];
  const email = sessionOf(req);

  if (req.method === 'POST' && path === '/api/auth/sign-in/email') {
    const body = await json(req);
    if (body['email'] === THROTTLED) return send(res, 429, { message: 'Too many requests' });
    if (body['email'] === DOWN) return send(res, 503, { message: 'Unavailable' });
    const known =
      typeof body['email'] === 'string' && (body['email'] === NO_ME || meOf(body['email']));
    // Better Auth answers a wrong password and a locked account with the same 401 (src/auth.ts WRONG_CREDENTIALS).
    if (!known || body['password'] !== GOOD)
      return send(res, 401, {
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      });
    const cookie = `${COOKIE}=${encodeURIComponent(String(body['email']))}; Path=/; HttpOnly; SameSite=Lax`;
    return send(res, 200, { redirect: false, token: 'e2e' }, { 'set-cookie': cookie });
  }
  if (req.method === 'POST' && path === '/api/auth/sign-out')
    return send(res, 200, { success: true }, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` });

  if (req.method === 'GET' && path === '/v1/me/security-status') {
    if (!email) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    return send(res, 200, { twoFactorEnabled: false, required: false, mustSetUp: false });
  }
  if (req.method === 'GET' && path === '/v1/me') {
    if (!email) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    const me = meOf(email);
    if (!me) return problem(res, 404, 'not_found', NO_ME_TRACE);
    return send(res, 200, me);
  }
  return problem(res, 404, 'not_found', 'trace-e2e-404');
}

/** Playwright `globalSetup`: starts the stub before the tests and returns the teardown that stops it. */
export default async function start(): Promise<() => Promise<void>> {
  const server = createServer((req, res) => {
    route(req, res).catch(() => problem(res, 500, 'internal_error', 'trace-e2e-500'));
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail); // EADDRINUSE: the real API is running on this port; stop it first (apps/admin/CLAUDE.md)
    server.listen(STUB_PORT, ok);
  });
  return () => new Promise<void>((ok) => server.close(() => ok()));
}
