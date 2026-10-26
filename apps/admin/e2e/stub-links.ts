// The links of an email, for the e2e stub API only, in the shapes of the Better Auth plugins of apps/api: #4 Nhận lời mời
// (/api/auth/invite/*, N151). Never deployed.
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

/** Answers /api/auth/invite/* and says true, or says false for any other path. */
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
  return false;
}
