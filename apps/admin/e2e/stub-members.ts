// #19 Thành viên for the e2e stub API only (N152, N153): inviting, sending an invitation again, the list of the company.
// `da-moi@` already has a pending invitation (409), `khong-gui@` is invited but its email does not go. Never deployed.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Member } from '../src/members/list';

/** The answers of stub-api.ts this module writes with. */
export interface Edge {
  readonly send: (res: ServerResponse, status: number, body: unknown) => void;
  readonly problem: (res: ServerResponse, status: number, code: string, traceId: string) => void;
  readonly json: (req: IncomingMessage) => Promise<Record<string, unknown>>;
}

const invitations = new Map<string, unknown>(); // Idempotency-Key → the invitation it made (keys are random, so tests never share one)
const invitedBy = new Map<string, string>(); // invitation id → the session that made it (its cookie), for that session's GET /v1/members

/** The company of every session in #19 Thành viên (N153), oldest first; the invitations a session makes come after them. */
export const MEMBERS = [
  ['owner', 'Người thử owner', 'owner@e2e.test', 'owner', 'active', true],
  ['admin', 'Người thử admin', 'admin@e2e.test', 'admin', 'active', false],
  ['sales', 'Người thử sales', 'sales@e2e.test', 'sales', 'active', true],
  ['support', 'Người thử support', 'support@e2e.test', 'support', 'suspended', true],
  ['moi', null, 'moi@example.test', 'sales', 'pending', false],
  ['cu', null, 'cu@example.test', 'owner', 'expired', false],
].map(([who, name, email, role, status, twoFactorEnabled], n) => ({
  id: `0190c000-0000-7000-8000-00000000000${n + 1}`,
  userId: name ? `user-${String(who)}` : null,
  name: name as string | null,
  email: email as string,
  role: role as Member['role'],
  status: status as Member['status'],
  twoFactorEnabled: twoFactorEnabled as boolean,
  expiresAt: name
    ? null
    : status === 'pending'
      ? '2026-10-28T03:00:00.000Z'
      : '2026-10-20T03:00:00.000Z',
}));
/** The page size of the stub's member list, small so that "Tải thêm" is tested. */
export const MEMBERS_PAGE = 4;

/** Answers a route of /v1/members and says true, or says false for any other path. `session` is null when signed out. */
export async function routeMembers(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): Promise<boolean> {
  const send = (r: ServerResponse, status: number, b: unknown) => (edge.send(r, status, b), true);
  const problem = (r: ServerResponse, status: number, code: string, trace: string) => (
    edge.problem(r, status, code, trace),
    true
  );
  const json = edge.json;
  // Inviting a member (N152): Owner any role, Admin any but Owner; `da-moi@` has a pending invitation, `khong-gui@` gets no email.
  if (req.method === 'POST' && path === '/v1/members/invite') {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    const key = req.headers['idempotency-key'];
    const { email, role } = await json(req);
    if (typeof key !== 'string' || typeof email !== 'string' || typeof role !== 'string')
      return problem(res, 400, 'validation_failed', 'trace-e2e-400');
    const done = invitations.get(key);
    if (done) return send(res, 201, done);
    const actor = session.role;
    if (actor !== 'owner' && (actor !== 'admin' || role === 'owner'))
      return problem(res, 403, 'forbidden', 'trace-e2e-403');
    if (email.startsWith('da-moi@'))
      return problem(res, 409, 'duplicate_resource', 'trace-e2e-409');
    const invitation = {
      id: randomUUID(),
      email,
      role,
      status: 'pending',
      expiresAt: '2026-10-29T03:00:00.000Z',
      emailSent: !email.startsWith('khong-gui@'),
    };
    invitations.set(key, invitation);
    invitedBy.set(invitation.id, session.sid);
    return send(res, 201, invitation);
  }
  // The members of the company (N153): Owner and Admin only, oldest first, by an index cursor.
  if (req.method === 'GET' && path === '/v1/members') {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    if (!['owner', 'admin'].includes(session.role ?? ''))
      return problem(res, 403, 'forbidden', 'trace-e2e-403');
    // The latest answer per invitation (a resend renews its expiry), only those this session made.
    const mine = new Map<string, (typeof MEMBERS)[number]>();
    for (const raw of invitations.values()) {
      const i = raw as { id: string; email: string; role: Member['role']; expiresAt: string };
      if (invitedBy.get(i.id) === session.sid)
        mine.set(i.id, { ...MEMBERS[4]!, ...i, status: 'pending' });
    }
    const all = [...MEMBERS, ...mine.values()];
    const from = Number(new URL(req.url ?? '/', 'http://stub').searchParams.get('cursor') ?? 0);
    const next = from + MEMBERS_PAGE;
    return send(res, 200, {
      data: all.slice(from, next),
      nextCursor: next < all.length ? String(next) : null,
    });
  }
  // Sending an invitation again (N152): a new link, 7 more days from the stub's "now", and this time the email goes.
  const resend = /^\/v1\/members\/([^/]+)\/resend-invite$/.exec(path ?? '');
  if (req.method === 'POST' && resend) {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string') return problem(res, 400, 'validation_failed', 'trace-e2e-400');
    const done = invitations.get(key);
    if (done) return send(res, 200, done);
    const listed = MEMBERS.find((m) => m.id === resend[1] && !m.userId);
    const first = (
      listed
        ? { id: listed.id, email: listed.email, role: listed.role, status: 'pending' }
        : [...invitations.values()].find((i) => (i as { id: string }).id === resend[1])
    ) as Record<string, unknown> | undefined;
    if (!first) return problem(res, 404, 'not_found', 'trace-e2e-404');
    if (first['role'] === 'owner' && session.role !== 'owner')
      return problem(res, 403, 'forbidden', 'trace-e2e-403');
    const renewed = { ...first, expiresAt: '2026-10-30T03:00:00.000Z', emailSent: true };
    invitations.set(key, renewed);
    return send(res, 200, renewed);
  }
  // Resetting a second factor (N155): the rules of a role change, a reason of 1 to 500 characters, an Idempotency-Key; the
  // support member of MEMBERS is also in another company here (409 shared_account). The stub answers without keeping it.
  const resetting = /^\/v1\/members\/([^/]+)\/2fa\/reset$/.exec(path);
  if (req.method === 'POST' && resetting) {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    const key = req.headers['idempotency-key'];
    const reason = (await json(req))['reason'];
    if (
      typeof key !== 'string' ||
      typeof reason !== 'string' ||
      !reason.trim() ||
      reason.length > 500
    )
      return problem(res, 400, 'validation_failed', 'trace-e2e-400');
    const actor = session.role;
    const m = MEMBERS.find((x) => x.id === resetting[1] && x.userId);
    if (actor !== 'owner' && actor !== 'admin')
      return problem(res, 403, 'forbidden', 'trace-e2e-403');
    if (!m) return problem(res, 404, 'not_found', 'trace-e2e-404');
    if (m.userId === `user-${actor}` || (actor === 'admin' && m.role === 'owner'))
      return problem(res, 403, 'forbidden', 'trace-e2e-403');
    if (m.role === 'support') return problem(res, 409, 'shared_account', 'trace-e2e-shared');
    return send(res, 200, { ...m, twoFactorEnabled: false });
  }
  // Changing a role (N154): Owner and Admin, never one's own; an Admin never to or from Owner; an invitation is not a member (404);
  // the company keeps an active Owner (409 last_owner). The stub answers the member in its new role without keeping it.
  const changing = /^\/v1\/members\/([^/]+)\/role$/.exec(path);
  if (req.method === 'PATCH' && changing) {
    if (!session) return problem(res, 401, 'unauthorized', 'trace-e2e-401');
    const to = (await json(req))['role'];
    if (typeof to !== 'string') return problem(res, 400, 'validation_failed', 'trace-e2e-400');
    const actor = session.role;
    const m = MEMBERS.find((x) => x.id === changing[1] && x.userId);
    if (actor !== 'owner' && actor !== 'admin')
      return problem(res, 403, 'forbidden', 'trace-e2e-403');
    if (!m) return problem(res, 404, 'not_found', 'trace-e2e-404');
    if (
      m.userId === `user-${actor}` ||
      (actor === 'admin' && (m.role === 'owner' || to === 'owner'))
    )
      return problem(res, 403, 'forbidden', 'trace-e2e-403');
    const owners = MEMBERS.filter(
      (x) => x.role === 'owner' && x.status === 'active' && x.id !== m.id,
    );
    if (m.role === 'owner' && to !== 'owner' && owners.length === 0)
      return problem(res, 409, 'last_owner', 'trace-e2e-409');
    return send(res, 200, { ...m, role: to });
  }
  return false;
}
