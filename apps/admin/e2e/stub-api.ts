// A stand-in for the API (Better Auth on /api/auth, /v1) for the end-to-end tests only: the admin under test is the real build,
// started by Playwright; this answers what it asks, in the shapes of Better Auth and of src/auth.ts, src/me.ts. Never deployed.
// Each email is one case: `<role>@e2e.test` signs straight in, `<role>+2fa@` asks for a code, `<role>+setup@` must set up 2FA,
// `<role>+gate@` gets 403 two_factor_setup_required from GET /v1/me (N93), `<role>+status-down@` a 503 from security-status,
// `<role>+inbox-empty@` and `<role>+inbox-down@` an empty or failing conversation list, `+claimed@` loses every claim,
// `+stale@` gets version_conflict on every other action.
// Every sign-in opens its own session, as Better Auth's cookie does, so tests that run side by side never share state.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Server } from 'socket.io';

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
/** `<role>+inbox-empty@`: no conversation; `<role>+inbox-down@`: GET /v1/conversations answers 500 with this trace. */
export const INBOX_DOWN_TRACE = 'trace-e2e-inbox-down';
/** The page size of the stub's conversation list, small so that "Tải thêm" is tested. */
export const STUB_PAGE = 3;

// The conversations of every workspace of the stub: who may see which is the rule of apps/api permissions.ts (canSee).
const conversation = (n: number, state: string, assignedUserId: string | null, hold = false) => ({
  id: `0190a000-0000-7000-8000-00000000000${n}`,
  workspaceId: 'ws-e2e',
  state,
  afterHoursHold: hold,
  assignedUserId,
  version: 1,
  outcome: state === 'CLOSED' ? 'resolved' : null,
  closedAt: state === 'CLOSED' ? '2026-10-21T03:00:00Z' : null,
  lastMessageAt: `2026-10-21T0${n}:05:00Z`,
  lastCustomerMessageAt: null,
  createdAt: '2026-10-20T00:00:00Z',
});
/** A message a customer could send to break a page (T2): it must show as these characters and run nothing. */
export const HOSTILE =
  '<script>window.__xss = 1</script><img src=x onerror="window.__xss = 1">**đậm**';
const message = (
  n: number,
  senderKind: string,
  body: string,
  platformSentAt: string | null,
  senderUserId: string | null = null,
) => ({
  id: `0190b000-0000-7000-8000-00000000000${n}`,
  sequenceNumber: n,
  senderKind,
  senderUserId,
  kind: 'text',
  body,
  platformSentAt,
  createdAt: `2026-10-21T02:0${n}:30Z`,
});
/** The messages of conversation #2 (sales holds it); #5 arrived late from Zalo and was sent before #4. */
export const MESSAGES = [
  message(1, 'customer', 'Chào shop, cho hỏi giá thùng 24 lon.', '2026-10-21T02:01:00Z'),
  message(2, 'bot', 'Dạ em chuyển anh/chị cho nhân viên ạ.', '2026-10-21T02:02:00Z'),
  message(3, 'agent', 'Dạ em chào anh, em gửi báo giá ngay.', null, 'user-sales'),
  message(4, 'customer', HOSTILE, '2026-10-21T02:06:00Z'),
  message(5, 'customer', 'Gửi lúc 02:05, tới sau.', '2026-10-21T02:05:00Z'),
];
export const CONVERSATIONS = [
  conversation(1, 'HUMAN_WAITING_Q', null),
  conversation(2, 'HUMAN_ACTIVE', 'user-sales'),
  conversation(3, 'PENDING_CUSTOMER', 'user-sales'),
  conversation(4, 'HUMAN_ACTIVE', 'user-manager'),
  conversation(5, 'HUMAN_WAITING_Q', null, true),
  conversation(6, 'CLOSED', 'user-sales'),
];

/** The codes of the authenticator app: the right one, a wrong one, and one that locks the account (5 wrong in a row). */
export const TOTP = { good: '123456', wrong: '000000', locking: '999999' } as const;
export const SECRET = 'JBSWY3DPEHPK3PXP';
export const BACKUP_CODES = Array.from({ length: 10 }, (_, i) => `e2e-backup-${i}`);

const SESSION = 'e2e_session';
const PENDING = 'e2e_two_factor'; // Better Auth's cookie between the password and the code

type StubConversation = (typeof CONVERSATIONS)[number];
interface Session {
  readonly email: string;
  mustSetUp: boolean;
  twoFactorEnabled: boolean;
  /** This session's own copy, so an action of one test never shows in another. */
  readonly conversations: StubConversation[];
  readonly messages: (typeof MESSAGES)[number][];
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
  sessions.set(id, {
    email,
    mustSetUp: kind === 'setup',
    twoFactorEnabled: kind === '2fa',
    conversations: structuredClone(CONVERSATIONS),
    messages: structuredClone(MESSAGES),
  });
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
  if (req.method === 'GET' && path === '/v1/conversations') {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    if (session.email.includes('+inbox-down@'))
      return problem(res, 500, 'internal_error', INBOX_DOWN_TRACE);
    const q = new URL(req.url ?? '/', 'http://stub').searchParams;
    const me = meOf(session.email);
    const role = me?.org?.role ?? '';
    const all = ['owner', 'admin', 'manager'].includes(role);
    const seen = session.email.includes('+inbox-empty@')
      ? []
      : session.conversations.filter(
          (c) =>
            (all || c.assignedUserId === null || c.assignedUserId === me?.id) &&
            (q.get('assignee') !== 'me' || c.assignedUserId === me?.id) &&
            (q.get('assignee') !== 'none' || c.assignedUserId === null) &&
            (!q.get('state') || c.state === q.get('state')) &&
            (q.get('hold') !== 'true' || c.afterHoursHold),
        );
    const from = Number(q.get('cursor') ?? 0);
    const next = from + STUB_PAGE < seen.length ? String(from + STUB_PAGE) : null;
    return send(res, 200, { data: seen.slice(from, from + STUB_PAGE), nextCursor: next });
  }
  const one = /^\/v1\/conversations\/([^/]+)(\/messages)?$/.exec(path ?? '');
  if (req.method === 'GET' && one) {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    const me = meOf(session.email);
    const all = ['owner', 'admin', 'manager'].includes(me?.org?.role ?? '');
    const c = session.conversations.find((x) => x.id === one[1]);
    // Not there and not visible are the same 404 (P9).
    if (!c || !(all || c.assignedUserId === null || c.assignedUserId === me?.id))
      return problem(res, 404, 'not_found', 'trace-e2e-404');
    if (!one[2]) return send(res, 200, c);
    const own = c.id === CONVERSATIONS[1]?.id ? [...session.messages].reverse() : [];
    const from = Number(new URL(req.url ?? '/', 'http://stub').searchParams.get('cursor') ?? 0);
    const next = from + STUB_PAGE < own.length ? String(from + STUB_PAGE) : null;
    return send(res, 200, { data: own.slice(from, from + STUB_PAGE), nextCursor: next });
  }
  // The actions of the Inbox (P9, P14): Idempotency-Key required, the version read, the FSM's from-states.
  const act = /^\/v1\/conversations\/([^/]+)\/(claim|wait-customer|close)$/.exec(path ?? '');
  if (req.method === 'POST' && act) {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    if (!req.headers['idempotency-key'])
      return problem(res, 400, 'validation_failed', 'trace-e2e-400');
    const body = await json(req);
    const me = meOf(session.email);
    const c = session.conversations.find((x) => x.id === act[1]);
    if (!c || !me) return problem(res, 404, 'not_found', 'trace-e2e-404');
    if (act[2] === 'claim') {
      if (session.email.includes('+claimed@') || c.state !== 'HUMAN_WAITING_Q') {
        Object.assign(c, {
          state: 'HUMAN_ACTIVE',
          assignedUserId: 'user-manager',
          version: c.version + 1,
        });
        res.writeHead(409, { 'content-type': 'application/problem+json' });
        return res.end(
          JSON.stringify({
            status: 409,
            code: 'conversation_already_claimed',
            traceId: 'trace-e2e-claimed',
            assignedUserId: 'user-manager',
          }),
        );
      }
      Object.assign(c, { state: 'HUMAN_ACTIVE', assignedUserId: me.id, version: c.version + 1 });
      return send(res, 200, c);
    }
    if (body['version'] !== c.version || session.email.includes('+stale@'))
      return problem(res, 409, 'version_conflict', 'trace-e2e-version');
    if (act[2] === 'wait-customer')
      Object.assign(c, { state: 'PENDING_CUSTOMER', version: c.version + 1 });
    else
      Object.assign(c, {
        state: 'CLOSED',
        outcome: body['outcome'],
        assignedUserId: null,
        version: c.version + 1,
      });
    return send(res, 200, c);
  }
  // Test-only levers for the socket of /agent (realtime.spec.ts): what the worker would send, and a dropped connection.
  if (req.method === 'POST' && path?.startsWith('/__e2e/')) {
    const body = await json(req);
    const sid = String(body['sid']);
    const s = sessions.get(sid);
    if (s) lever(path.slice(7), sid, s, body);
    return send(res, 200, { ok: true });
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

// A stand-in for Socket.IO /agent (realtime spec §2–5): the handshake checks Origin and the session cookie like the API, the
// rooms are made from the session (named per session here, so tests running side by side never hear each other).
let agent: ReturnType<Server['of']> | null = null;
const room = (sid: string, what: string) => `${sid}:${what}`;
const envelope = (type: string, version: number, data: object) => ({
  eventId: randomUUID(),
  type,
  aggregateVersion: version,
  data,
});

function lever(name: string, sid: string, s: Session, body: Record<string, unknown>) {
  const c = s.conversations.find((x) => x.id === body['conversationId']);
  if (name === 'message' && c) {
    const n = Math.max(...s.messages.map((m) => m.sequenceNumber)) + 1;
    const m = {
      ...s.messages[0]!,
      id: `0190b000-0000-7000-8000-0000000001${n}`,
      sequenceNumber: n,
      body: String(body['body']),
      platformSentAt: null,
      createdAt: new Date().toISOString(),
    };
    s.messages.push(m);
    const { id, ...rest } = m;
    agent
      ?.to(room(sid, `conv:${c.id}`))
      .emit(
        'message.created',
        envelope('message.created', c.version, { conversationId: c.id, messageId: id, ...rest }),
      );
    agent?.to(room(sid, 'ws')).emit(
      'message.created',
      envelope('message.created', c.version, {
        conversationId: c.id,
        sequenceNumber: n,
        senderKind: m.senderKind,
        createdAt: m.createdAt,
      }),
    );
  }
  if (name === 'state' && c) {
    Object.assign(c, { state: body['to'], version: c.version + 1 });
    const data = {
      conversationId: c.id,
      to: c.state,
      hold: c.afterHoursHold,
      version: c.version,
      assignedUserId: c.assignedUserId,
    };
    agent
      ?.to([room(sid, `conv:${c.id}`), room(sid, 'ws')])
      .emit('conversation.state_changed', envelope('conversation.state_changed', c.version, data));
  }
  // Closes the transport, as a lost network does: the client reconnects by itself (a server disconnect would not).
  if (name === 'drop')
    for (const socket of agent?.sockets.values() ?? [])
      if (socket.rooms.has(room(sid, 'ws'))) socket.conn.close();
  if (name === 'end') {
    agent
      ?.to(room(sid, 'ws'))
      .emit('session.ended', { code: 'unauthorized', traceId: 'trace-e2e-ended' });
    sessions.delete(sid);
  }
}

function attachAgent(server: ReturnType<typeof createServer>) {
  agent = new Server(server, { transports: ['websocket'] }).of('/agent');
  agent.use((socket, next) => {
    const sid = /(?:^|; )e2e_session=([^;]+)/.exec(socket.request.headers.cookie ?? '')?.[1];
    if (socket.request.headers.origin !== 'http://localhost:3001')
      return next(new Error('forbidden_origin'));
    if (!sid || !sessions.has(sid)) return next(new Error('unauthorized'));
    socket.data = { sid };
    next();
  });
  agent.on('connection', (socket) => {
    const { sid } = socket.data as { sid: string };
    void socket.join(room(sid, 'ws'));
    const visible = (id: unknown) => sessions.get(sid)?.conversations.find((c) => c.id === id);
    socket.on(
      'conversation.subscribe',
      ({ conversationId }: { conversationId: string }, ack: (a: object) => void) => {
        if (!visible(conversationId)) return ack({ ok: false, code: 'not_found' });
        void socket.join(room(sid, `conv:${conversationId}`));
        ack({ ok: true });
      },
    );
    socket.on(
      'conversation.unsubscribe',
      ({ conversationId }: { conversationId: string }, ack: (a: object) => void) => {
        void socket.leave(room(sid, `conv:${conversationId}`));
        ack({ ok: true });
      },
    );
    socket.on(
      'resume',
      (
        {
          conversationId,
          lastSequenceNumber,
        }: { conversationId: string; lastSequenceNumber: number },
        ack: (a: object) => void,
      ) => {
        const c = visible(conversationId);
        if (!c) return ack({ ok: false, code: 'not_found' });
        void socket.join(room(sid, `conv:${conversationId}`));
        const own = c.id === CONVERSATIONS[1]?.id ? (sessions.get(sid)?.messages ?? []) : [];
        const messages = own
          .filter((m) => m.sequenceNumber > lastSequenceNumber)
          .map(({ id, ...m }) => ({ messageId: id, ...m }));
        ack({
          ok: true,
          conversation: {
            id: c.id,
            state: c.state,
            hold: c.afterHoursHold,
            version: c.version,
            assignedUserId: c.assignedUserId,
          },
          messages,
          hasMore: false,
          resync: false,
        });
      },
    );
  });
}

/** Playwright `globalSetup`: starts the stub before the tests and returns the teardown that stops it. */
export default async function start(): Promise<() => Promise<void>> {
  const server = createServer((req, res) => {
    route(req, res).catch(() => problem(res, 500, 'internal_error', 'trace-e2e-500'));
  });
  attachAgent(server);
  await new Promise<void>((ok, fail) => {
    server.once('error', fail); // EADDRINUSE: the real API is running on this port; stop it first (apps/admin/CLAUDE.md)
    server.listen(STUB_PORT, ok);
  });
  return () =>
    new Promise<void>((ok) => {
      void agent?.server.close();
      server.close(() => ok());
    });
}
