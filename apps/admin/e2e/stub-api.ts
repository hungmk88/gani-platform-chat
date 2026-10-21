// A stand-in for the API (Better Auth on /api/auth, /v1) for the end-to-end tests only: the admin under test is the real build,
// started by Playwright; this answers what it asks, in the shapes of Better Auth and of src/auth.ts, src/me.ts. Never deployed.
// Each email is one case: `<role>@e2e.test` signs straight in, `<role>+2fa@` asks for a code, `<role>+setup@` must set up 2FA,
// `<role>+gate@` gets 403 two_factor_setup_required from GET /v1/me (N93), `<role>+status-down@` a 503 from security-status.
// Every sign-in opens its own session, as Better Auth's cookie does, so tests that run side by side never share state.
import { randomUUID } from 'node:crypto';
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
/** `<role>+status-down@`: signs in, then `GET /v1/me/security-status` answers 503 with this trace. */
export const STATUS_DOWN_TRACE = 'trace-e2e-status-down';

/** The codes of the authenticator app: the right one, a wrong one, and one that locks the account (5 wrong in a row). */
export const TOTP = { good: '123456', wrong: '000000', locking: '999999' } as const;
export const SECRET = 'JBSWY3DPEHPK3PXP';
export const BACKUP_CODES = Array.from({ length: 10 }, (_, i) => `e2e-backup-${i}`);

const SESSION = 'e2e_session';
const PENDING = 'e2e_two_factor'; // Better Auth's cookie between the password and the code

interface Session {
  readonly email: string;
  mustSetUp: boolean;
  twoFactorEnabled: boolean;
}
const sessions = new Map<string, Session>();
const pending = new Map<string, string>(); // pending id → email
const usedBackupCodes = new Set<string>();

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
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

function cookie(req: IncomingMessage, name: string): string | null {
  const pair = (req.headers.cookie ?? '').split('; ').find((c) => c.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : null;
}
const setCookie = (name: string, value: string) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${value ? '' : '; Max-Age=0'}`;

/** A new session and its cookie: Better Auth's answer to a password (or a code) that is right. */
function open(email: string): string {
  const id = randomUUID();
  const kind = email.split('@')[0]?.split('+')[1];
  sessions.set(id, { email, mustSetUp: kind === 'setup', twoFactorEnabled: kind === '2fa' });
  return setCookie(SESSION, id);
}

/** The person of `GET /v1/me` (src/me.ts), from the part of the email before `+` or `@`: a role of src/nav.ts. */
function meOf(email: string) {
  const role = email.split('@')[0]?.split('+')[0] ?? '';
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
  const session = sessions.get(cookie(req, SESSION) ?? '');

  if (req.method === 'POST' && path === '/api/auth/sign-in/email') {
    const { email, password } = await json(req);
    if (email === THROTTLED) return send(res, 429, { message: 'Too many requests' });
    if (email === DOWN) return send(res, 503, { message: 'Unavailable' });
    // Better Auth answers a wrong password and a locked account with the same 401 (src/auth.ts WRONG_CREDENTIALS).
    if (typeof email !== 'string' || (email !== NO_ME && !meOf(email)) || password !== GOOD)
      return send(res, 401, {
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      });
    if (email.includes('+2fa@')) {
      const id = randomUUID();
      pending.set(id, email);
      return send(res, 200, { twoFactorRedirect: true }, { 'set-cookie': setCookie(PENDING, id) });
    }
    return send(res, 200, { redirect: false, token: 'e2e' }, { 'set-cookie': open(email) });
  }
  if (req.method === 'POST' && path === '/api/auth/sign-out') {
    sessions.delete(cookie(req, SESSION) ?? '');
    return send(res, 200, { success: true }, { 'set-cookie': setCookie(SESSION, '') });
  }

  // Set-up of 2FA by a signed-in person: the password again, then the URI and the 10 codes; verify-totp turns it on.
  if (req.method === 'POST' && path === '/api/auth/two-factor/enable') {
    if (!session) return send(res, 401, { code: 'UNAUTHORIZED' });
    if (session.twoFactorEnabled) return send(res, 400, { code: 'TOTP_ALREADY_ENABLED' });
    if ((await json(req))['password'] !== GOOD) return send(res, 400, { code: 'INVALID_PASSWORD' });
    const totpURI = `otpauth://totp/Gani%20Platform:${session.email}?secret=${SECRET}&issuer=Gani%20Platform`;
    return send(res, 200, { totpURI, backupCodes: BACKUP_CODES });
  }
  if (req.method === 'POST' && path?.startsWith('/api/auth/two-factor/verify-')) {
    const backup = path.endsWith('/verify-backup-code');
    const code = (await json(req))['code'];
    const pendingId = cookie(req, PENDING) ?? '';
    const email = session?.email ?? pending.get(pendingId);
    if (!email) return send(res, 401, { code: 'INVALID_TWO_FACTOR_COOKIE' });
    if (!backup && code === TOTP.locking)
      return send(res, 401, { code: 'ACCOUNT_TEMPORARILY_LOCKED' });
    const right = backup
      ? typeof code === 'string' && BACKUP_CODES.includes(code) && !usedBackupCodes.has(code)
      : code === TOTP.good;
    if (!right) return send(res, 401, { code: backup ? 'INVALID_BACKUP_CODE' : 'INVALID_CODE' });
    if (backup) usedBackupCodes.add(code as string);
    if (session) {
      session.twoFactorEnabled = true;
      session.mustSetUp = false;
      return send(res, 200, { status: true });
    }
    pending.delete(pendingId);
    return send(
      res,
      200,
      { token: 'e2e' },
      { 'set-cookie': [open(email), setCookie(PENDING, '')] },
    );
  }

  if (req.method === 'GET' && path === '/v1/me/security-status') {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    if (session.email.includes('+status-down@'))
      return problem(res, 503, 'internal_error', STATUS_DOWN_TRACE);
    const { twoFactorEnabled, mustSetUp } = session;
    return send(res, 200, { twoFactorEnabled, required: mustSetUp, mustSetUp });
  }
  if (req.method === 'GET' && path === '/v1/me') {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    if (session.email.includes('+gate@') && !session.twoFactorEnabled)
      return problem(res, 403, 'two_factor_setup_required', 'trace-e2e-403');
    const me = meOf(session.email);
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
