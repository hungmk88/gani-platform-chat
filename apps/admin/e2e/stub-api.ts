// A stand-in for the API (Better Auth on /api/auth, /v1) for the end-to-end tests only: the admin under test is the real build,
// started by Playwright; this answers what it asks, in the shapes of Better Auth and of src/auth.ts, src/me.ts. Never deployed.
// Each email is one case: `<role>@e2e.test` signs straight in, `<role>+2fa@` asks for a code, `<role>+setup@` must set up 2FA,
// `<role>+gate@` gets 403 two_factor_setup_required from GET /v1/me (N93), `<role>+status-down@` a 503 from security-status,
// `<role>+inbox-empty@` and `<role>+inbox-down@` an empty or failing conversation list, `+claimed@` loses every claim,
// `+stale@` gets version_conflict on every other action, `+many@` has MANY conversations waiting, `+window@` has the channel's free window closed when answering;
// the tokens of INVITES open #4 Nhận lời mời.
// Inviting a member: `da-moi@` and `khong-gui@` (e2e/stub-members.ts).
// Every sign-in opens its own session, as Better Auth's cookie does, so tests that run side by side never share state.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { Me } from '../src/me';
import { ROLES, type Role } from '../src/nav';
import { attachAgent, type Agent } from './stub-agent';
import { MEMBERS, routeMembers } from './stub-members';
import { routeChannels } from './stub-channels';
import { routeTeams } from './stub-teams';
import { routeWorkspaces } from './stub-workspaces';

export const STUB_PORT = 3000; // API_ORIGIN of the admin when it is not set (next.config.ts, src/me.server.ts)
export const GOOD = 'mat-khau-dung-e2e';
export const accountOf = (who: string) => `${who}@e2e.test`;

/** Signs in, then `GET /v1/me` answers 404 (an API without the route): the shell shows the error page with this trace. */
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
/** `<role>+many@`: this many conversations waiting in the queue, by pages of MANY_PAGE, for the virtualised list. */
export const MANY = 600;
export const MANY_PAGE = 200;
/** Links of #4 Nhận lời mời (N151): the token of each case → whom it invites; any other token is refused like an expired one. */
export const INVITES = {
  sales: { token: 'e2e-invite-sales-0000000000000', invitedEmail: 'sales@e2e.test', role: 'sales' },
  owner: {
    token: 'e2e-invite-owner-0000000000000',
    invitedEmail: 'owner+setup@e2e.test',
    role: 'owner',
  },
  throttled: { token: 'e2e-invite-throttled-000000000', invitedEmail: '', role: '' },
} as const;

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
type StubMessage = (typeof MESSAGES)[number] & { deliveryStatus?: 'pending' };
interface Session {
  readonly email: string;
  mustSetUp: boolean;
  twoFactorEnabled: boolean;
  /** This session's own copy, so an action of one test never shows in another. */
  readonly conversations: StubConversation[];
  readonly messages: StubMessage[];
  /** Idempotency-Key → the message it made, so sending again gives the first answer back (N134). */
  readonly sent: Map<string, StubMessage>;
}
const sessions = new Map<string, Session>();
const pending = new Map<string, string>(); // pending id → email
const usedBackupCodes = new Set<string>();
const names = new Map<string, string>(); // session → the name it chose (PATCH /v1/me)

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
    conversations: email.includes('+many@')
      ? Array.from({ length: MANY }, (_, n) => ({
          ...CONVERSATIONS[0]!,
          id: `0190d000-0000-7000-8000-${String(n).padStart(12, '0')}`,
        }))
      : structuredClone(CONVERSATIONS),
    messages: structuredClone(MESSAGES),
    sent: new Map(),
  });
  return setCookie(SESSION, id);
}

/** The person of `GET /v1/me` (schema `Me`, src/me.ts), from the part of the email before `+` or `@`: a role of src/nav.ts. */
function meOf(email: string): Me | null {
  const role = email.split('@')[0]?.split('+')[0] ?? '';
  if (!(ROLES as readonly string[]).includes(role)) return null;
  const operator = role === 'platform_operator';
  return {
    id: `user-${role}`,
    name: `Người thử ${role}`,
    isPlatformOperator: operator,
    org: operator
      ? null
      : { id: 'org-e2e', name: 'Công ty thử', role: role as Exclude<Role, 'platform_operator'> },
    workspaces: operator
      ? []
      : [
          { id: 'ws-e2e', name: 'Workspace thử' },
          ...(email.includes('+multi@') ? [{ id: 'ws-e2e-2', name: 'Workspace hai' }] : []),
        ],
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
  // #4 Nhận lời mời (N151): one answer for every refused token; accept opens the session of the invited person.
  if (req.method === 'POST' && path?.startsWith('/api/auth/invite/')) {
    const body = await json(req);
    if (body['token'] === INVITES.throttled.token) return send(res, 429, { code: 'RATE_LIMITED' });
    const invite = Object.values(INVITES).find((i) => i.token === body['token'] && i.role);
    if (!invite)
      return send(res, 404, {
        code: 'INVITE_INVALID',
        message: 'Link không hợp lệ hoặc đã hết hạn.',
      });
    const { invitedEmail, role } = invite;
    if (path.endsWith('/lookup')) return send(res, 200, { invitedEmail, role });
    if (session) return send(res, 200, { orgId: 'org-e2e', role });
    if (typeof body['password'] !== 'string' || body['password'].length < 12)
      return send(res, 400, { code: 'PASSWORD_TOO_WEAK' });
    return send(res, 200, { orgId: 'org-e2e', role }, { 'set-cookie': open(invitedEmail) });
  }
  if (req.method === 'POST' && path === '/api/auth/sign-out') {
    sessions.delete(cookie(req, SESSION) ?? '');
    return send(res, 200, { success: true }, { 'set-cookie': setCookie(SESSION, '') });
  }

  // #5 Hồ sơ cá nhân: Better Auth checks the current password and the length of the new one; the rest is the admin's (ADR-003).
  if (req.method === 'POST' && path === '/api/auth/change-password') {
    if (!session) return send(res, 401, { code: 'UNAUTHORIZED' });
    const body = await json(req);
    if (body['currentPassword'] !== GOOD) return send(res, 400, { code: 'INVALID_PASSWORD' });
    const next = body['newPassword'];
    if (typeof next !== 'string' || next.length < 12)
      return send(res, 400, { code: 'PASSWORD_TOO_SHORT' });
    return send(res, 200, { token: null, user: { id: meOf(session.email)?.id } });
  }
  if (req.method === 'POST' && path === '/api/auth/revoke-other-sessions') {
    if (!session) return send(res, 401, { code: 'UNAUTHORIZED' });
    return send(res, 200, { status: true });
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
            (q.get('hold') !== 'true' || c.afterHoursHold) &&
            (!q.get('workspaceId') || c.workspaceId === q.get('workspaceId')),
        );
    const from = Number(q.get('cursor') ?? 0);
    const size = session.email.includes('+many@') ? MANY_PAGE : STUB_PAGE;
    const next = from + size < seen.length ? String(from + size) : null;
    return send(res, 200, { data: seen.slice(from, from + size), nextCursor: next });
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
  // Assigning (T16/T21, Phụ lục B row 16): Owner, Admin, Manager; to an active member of MEMBERS who may hold it, not its holder.
  // The Admin of MEMBERS is not in this conversation's workspace here, so picking them answers 422 invalid_assignee.
  const assign = /^\/v1\/conversations\/([^/]+)\/assign$/.exec(path ?? '');
  if (req.method === 'POST' && assign) {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    const { version, toUserId } = await json(req);
    const me = meOf(session.email);
    const c = session.conversations.find((x) => x.id === assign[1]);
    if (!c || !me) return problem(res, 404, 'not_found', 'trace-e2e-404');
    if (!['owner', 'admin', 'manager'].includes(me.org?.role ?? ''))
      return problem(res, 403, 'forbidden', 'trace-e2e-403');
    if (version !== c.version) return problem(res, 409, 'version_conflict', 'trace-e2e-version');
    const to = MEMBERS.find((m) => m.userId === toUserId && m.status === 'active');
    if (!to || toUserId === c.assignedUserId || to.userId === 'user-admin')
      return problem(res, 422, 'invalid_assignee', 'trace-e2e-422');
    Object.assign(c, { state: 'HUMAN_ACTIVE', assignedUserId: to.userId, version: c.version + 1 });
    return send(res, 200, c);
  }
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
  // Answering the customer (N146): only while a person holds it, sales/support their own, inside the channel's free window.
  const reply = /^\/v1\/conversations\/([^/]+)\/messages$/.exec(path ?? '');
  if (req.method === 'POST' && reply) {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    const key = req.headers['idempotency-key'];
    const raw = (await json(req))['text'];
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (typeof key !== 'string' || !text || text.length > 2000)
      return problem(res, 400, 'validation_failed', 'trace-e2e-400');
    const done = session.sent.get(key);
    if (done) return send(res, 201, done);
    const me = meOf(session.email);
    const c = session.conversations.find((x) => x.id === reply[1]);
    if (!c || !me) return problem(res, 404, 'not_found', 'trace-e2e-404');
    if (!['HUMAN_ACTIVE', 'PENDING_CUSTOMER'].includes(c.state))
      return problem(res, 409, 'conversation_not_active', 'trace-e2e-not-active');
    if (!['owner', 'admin', 'manager'].includes(me.org?.role ?? '') && c.assignedUserId !== me.id)
      return problem(res, 403, 'forbidden', 'trace-e2e-403');
    if (session.email.includes('+window@')) {
      res.writeHead(422, { 'content-type': 'application/problem+json' });
      return res.end(
        JSON.stringify({
          status: 422,
          code: 'channel_window_closed',
          traceId: 'trace-e2e-window',
          windowState: 'api_closed',
          reason: 'window_expired',
        }),
      );
    }
    const n = Math.max(...session.messages.map((m) => m.sequenceNumber)) + 1;
    const m: StubMessage = {
      id: `0190b000-0000-7000-8000-${String(n).padStart(12, '0')}`,
      sequenceNumber: n,
      senderKind: 'agent',
      senderUserId: me.id,
      kind: 'text',
      body: text,
      platformSentAt: null,
      createdAt: new Date().toISOString(),
      deliveryStatus: 'pending',
    };
    if (c.id === CONVERSATIONS[1]?.id) session.messages.push(m);
    session.sent.set(key, m);
    return send(res, 201, m);
  }
  // #19 Thành viên (N152–N156), #21 Workspace (N157–N159), #20 Team (N160), #24 Kênh (N161): e2e/stub-{members,workspaces,teams,channels}.ts.
  if (
    path &&
    ['/v1/members', '/v1/workspaces', '/v1/teams', '/v1/channels'].some((p) => path.startsWith(p))
  ) {
    const sid = cookie(req, SESSION) ?? '';
    const who = session ? { sid, role: meOf(session.email)?.org?.role } : null;
    if (await routeMembers(req, res, path, who, { send, problem, json })) return;
    if (await routeWorkspaces(req, res, path, who, { send, problem, json })) return;
    if (await routeTeams(req, res, path, who, { send, problem, json })) return;
    if (await routeChannels(req, res, path, who, { send, problem, json })) return;
  }
  // Test-only levers for the socket of /agent (realtime.spec.ts): what the worker would send, and a dropped connection.
  if (req.method === 'POST' && path?.startsWith('/__e2e/')) {
    const body = await json(req);
    const sid = String(body['sid']);
    const s = sessions.get(sid);
    if (s) agent?.lever(path.slice(7), sid, body);
    return send(res, 200, { ok: true });
  }
  // #5 Đổi tên (N162): only `name`, 1–100 characters once trimmed; kept per session, then answered as GET /v1/me.
  if (req.method === 'PATCH' && path === '/v1/me' && session) {
    const body = await json(req);
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    if (Object.keys(body).join() !== 'name' || !name || name.length > 100)
      return problem(res, 400, 'validation_failed', 'trace-e2e-400');
    names.set(cookie(req, SESSION) ?? '', name);
  }
  if ((req.method === 'GET' || req.method === 'PATCH') && path === '/v1/me') {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    if (session.email.includes('+gate@') && !session.twoFactorEnabled)
      return problem(res, 403, 'two_factor_setup_required', 'trace-e2e-403');
    const me = meOf(session.email);
    if (!me) return problem(res, 404, 'not_found', NO_ME_TRACE);
    return send(res, 200, { ...me, name: names.get(cookie(req, SESSION) ?? '') ?? me.name });
  }
  return problem(res, 404, 'not_found', 'trace-e2e-404');
}

let agent: Agent | null = null;

/** Playwright `globalSetup`: starts the stub before the tests and returns the teardown that stops it. */
export default async function start(): Promise<() => Promise<void>> {
  const server = createServer((req, res) => {
    route(req, res).catch(() => problem(res, 500, 'internal_error', 'trace-e2e-500'));
  });
  agent = attachAgent(server, sessions, CONVERSATIONS[1]!.id);
  await new Promise<void>((ok, fail) => {
    server.once('error', fail); // EADDRINUSE: the real API is running on this port; stop it first (apps/admin/CLAUDE.md)
    server.listen(STUB_PORT, ok);
  });
  return () =>
    new Promise<void>((ok) => {
      agent?.close();
      server.close(() => ok());
    });
}
