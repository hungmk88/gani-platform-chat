// The links of an email, for the e2e stub API only, in the shapes of the Better Auth plugins of apps/api: #4 Nhận lời mời
// (/api/auth/invite/*, N151) and "Quên mật khẩu" (/api/auth/password/*, N162). Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

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

/** Links of "Đặt lại mật khẩu" (N162): `good` works once, `throttled` is limited; any other token is refused like an expired one. */
export const RESETS = {
  good: 'e2e-reset-good-000000000000000',
  throttled: 'e2e-reset-throttled-0000000000',
} as const;

/** The email /password/forgot refuses as not one (the API's INVALID_EMAIL); every other address is 202. */
export const NOT_AN_EMAIL = 'khong-phai-email';

const used = new Set<string>(); // reset tokens spent
const INVALID = { message: 'Link không hợp lệ hoặc đã hết hạn.' };

interface Edge {
  readonly send: (
    res: ServerResponse,
    status: number,
    body: unknown,
    headers?: Record<string, string>,
  ) => void;
  readonly json: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  /** Opens the session of an email; its Set-Cookie. */
  readonly open: (email: string) => string;
}

/** Answers /api/auth/invite/* and /api/auth/password/* and says true, or says false for any other path. */
export async function routeLinks(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  signedIn: boolean,
  { send, json, open }: Edge,
): Promise<boolean> {
  if (req.method !== 'POST') return false;
  // #4 Nhận lời mời (N151): one answer for every refused token; accept opens the session of the invited person.
  if (path.startsWith('/api/auth/invite/')) {
    const body = await json(req);
    if (body['token'] === INVITES.throttled.token)
      return (send(res, 429, { code: 'RATE_LIMITED' }), true);
    const invite = Object.values(INVITES).find((i) => i.token === body['token'] && i.role);
    if (!invite) return (send(res, 404, { code: 'INVITE_INVALID', ...INVALID }), true);
    const { invitedEmail, role } = invite;
    if (path.endsWith('/lookup')) return (send(res, 200, { invitedEmail, role }), true);
    if (signedIn) return (send(res, 200, { orgId: 'org-e2e', role }), true);
    if (typeof body['password'] !== 'string' || body['password'].length < 12)
      return (send(res, 400, { code: 'PASSWORD_TOO_WEAK' }), true);
    return (send(res, 200, { orgId: 'org-e2e', role }, { 'set-cookie': open(invitedEmail) }), true);
  }
  // "Quên mật khẩu" (N162): forgot is always 202 for an address; reset checks the password before spending the token, makes no session.
  if (path === '/api/auth/password/forgot') {
    const email = (await json(req))['email'];
    if (typeof email !== 'string' || !email.includes('@') || email === NOT_AN_EMAIL)
      return (send(res, 400, { code: 'INVALID_EMAIL' }), true);
    return (send(res, 202, { accepted: true }), true);
  }
  if (path === '/api/auth/password/reset') {
    const { token, password } = await json(req);
    if (token === RESETS.throttled) return (send(res, 429, { code: 'RATE_LIMITED' }), true);
    if (token !== RESETS.good || used.has(token))
      return (send(res, 404, { code: 'RESET_INVALID', ...INVALID }), true);
    const strong =
      typeof password === 'string' &&
      password.length >= 12 &&
      /[A-Za-z]/.test(password) &&
      /\d/.test(password);
    if (!strong) return (send(res, 400, { code: 'PASSWORD_TOO_WEAK' }), true);
    used.add(token);
    return (send(res, 200, { reset: true }), true);
  }
  return false;
}
