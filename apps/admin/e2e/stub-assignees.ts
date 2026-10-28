// U31 for the e2e stub API only: `GET /v1/conversations/{id}/assignees?purpose=assign|transfer` (N168, #363) as the API answers it:
// active members of the conversation's workspace (`peopleOf`) who may hold conversations, not its holder; a Sales/Support transfer,
// only those who share a team with the caller. By name, no name last; no paging, and nobody left out for being full. Also
// `POST …/transfer` (T15, #376): the holder's own (Sales/Support) or any held one (leads), from HUMAN_ACTIVE or PENDING_CUSTOMER
// (else 409 invalid_transition), the version read (`+stale@` 409 version_conflict), to one U31 lists (else 422). Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import { MEMBERS } from './stub-members';
import { START, TEAMS } from './stub-teams';
import { peopleOf } from './stub-workspaces';

const HOLDS = ['owner', 'admin', 'manager', 'sales', 'support'];
const LEADS = ['owner', 'admin', 'manager'];
const DEFAULT_MAX = 5; // the workspace's default limit of the stub (e2e/stub-workspaces.ts)

const teamOf = (memberId: string) => TEAMS.find((t) => START[t.id]?.includes(memberId)) ?? null;

/** The answer of the route: a status and its body, or the code of a refusal. */
export function assigneesAnswer(
  c: { readonly workspaceId: string; readonly assignedUserId: string | null },
  viewer: { readonly id: string; readonly role: string },
  purpose: string | null,
  sid: string,
  held: readonly { readonly assignedUserId: string | null; readonly state: string }[],
):
  | { readonly status: 200; readonly body: unknown }
  | { readonly status: 400 | 403; readonly code: string } {
  if (purpose !== 'assign' && purpose !== 'transfer')
    return { status: 400, code: 'validation_failed' };
  const lead = LEADS.includes(viewer.role);
  if (
    purpose === 'assign'
      ? !lead
      : !HOLDS.includes(viewer.role) || (!lead && c.assignedUserId !== viewer.id)
  )
    return { status: 403, code: 'forbidden' };
  const inWorkspace = peopleOf(sid, c.workspaceId);
  const mine = MEMBERS.find((m) => m.userId === viewer.id);
  const myTeams = mine ? TEAMS.filter((t) => START[t.id]?.includes(mine.id)).map((t) => t.id) : [];
  const data = MEMBERS.filter(
    (m) =>
      m.status === 'active' &&
      m.userId &&
      m.userId !== c.assignedUserId &&
      HOLDS.includes(m.role) &&
      inWorkspace.includes(m.id) &&
      (purpose === 'assign' || lead || myTeams.some((t) => START[t]?.includes(m.id))),
  ).map((m) => {
    const team = teamOf(m.id);
    return {
      userId: m.userId,
      name: m.name,
      role: m.role,
      teamId: team?.id ?? null,
      teamName: team?.name ?? null,
      // As app.held_conversation_counts_by_state: the load is HUMAN_ACTIVE, waiting for the customer is apart (Brief §M04).
      openCount: held.filter((x) => x.assignedUserId === m.userId && x.state === 'HUMAN_ACTIVE')
        .length,
      awaitingCustomerCount: held.filter(
        (x) => x.assignedUserId === m.userId && x.state === 'PENDING_CUSTOMER',
      ).length,
      maxConcurrent: m.maxConcurrentConversations ?? DEFAULT_MAX,
    };
  });
  // Conversation #4 of the stub (HUMAN_ACTIVE, Manager holds it) has a crowd, so the dialog's search box shows (SEARCH_FROM).
  if (c.workspaceId === 'ws-e2e' && c.assignedUserId === 'user-manager')
    for (const [n, name] of ['Lan', 'Hùng', 'Đức', 'Mai', 'Tú', 'Ngọc', 'Bảo', 'Vy'].entries())
      data.push({
        ...data[0]!,
        userId: `user-crowd-${n}`,
        name: `Nhân viên ${name}`,
        role: 'support',
        teamId: null,
        teamName: null,
      });
  // By name, no name last, as the API.
  data.sort((x, y) =>
    x.name === null ? 1 : y.name === null ? -1 : x.name.localeCompare(y.name, 'vi'),
  );
  return { status: 200, body: { data } };
}

type Held = {
  readonly id: string;
  readonly workspaceId: string;
  assignedUserId: string | null;
  readonly state: string;
  version: number;
};

/** Answers GET /v1/conversations/{id}/assignees and POST …/transfer and says true, or says false for any other route. */
export async function routeAssignees(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session:
    | {
        readonly sid: string;
        readonly me: { readonly id: string; readonly org: { readonly role: string } | null } | null;
        readonly held: Held[];
        readonly email: string;
      }
    | null
    | undefined,
  edge: {
    readonly send: (res: ServerResponse, status: number, body: unknown) => void;
    readonly problem: (res: ServerResponse, status: number, code: string, traceId: string) => void;
    readonly json: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  },
): Promise<boolean> {
  const moving = /^\/v1\/conversations\/([^/]+)\/transfer$/.exec(path)?.[1];
  if (req.method === 'POST' && moving) {
    if (!session?.me?.org) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
    const me = { id: session.me.id, role: session.me.org.role };
    const c = session.held.find((x) => x.id === moving);
    if (!c || !(LEADS.includes(me.role) || c.assignedUserId === null || c.assignedUserId === me.id))
      return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    const { version, toUserId } = await edge.json(req);
    if (!req.headers['idempotency-key'] || typeof toUserId !== 'string')
      return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
    const listed = assigneesAnswer(c, me, 'transfer', session.sid, session.held);
    if (listed.status !== 200) return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
    if (version !== c.version || session.email.includes('+stale@'))
      return (edge.problem(res, 409, 'version_conflict', 'trace-e2e-version'), true);
    if (c.state !== 'HUMAN_ACTIVE' && c.state !== 'PENDING_CUSTOMER')
      return (edge.problem(res, 409, 'invalid_transition', 'trace-e2e-409'), true);
    if (!(listed.body as { data: { userId: string }[] }).data.some((p) => p.userId === toUserId))
      return (edge.problem(res, 422, 'invalid_assignee', 'trace-e2e-422'), true);
    Object.assign(c, { assignedUserId: toUserId, version: c.version + 1 });
    return (edge.send(res, 200, c), true);
  }
  const id = /^\/v1\/conversations\/([^/]+)\/assignees$/.exec(path)?.[1];
  if (req.method !== 'GET' || !id) return false;
  if (!session?.me?.org) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  const c = session.held.find((x) => x.id === id);
  if (!c) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const purpose = new URL(req.url ?? '/', 'http://stub').searchParams.get('purpose');
  const a = assigneesAnswer(
    c,
    { id: session.me.id, role: session.me.org.role },
    purpose,
    session.sid,
    session.held,
  );
  if (a.status === 200) edge.send(res, 200, a.body);
  else edge.problem(res, a.status, a.code, `trace-e2e-${a.status}`);
  return true;
}
