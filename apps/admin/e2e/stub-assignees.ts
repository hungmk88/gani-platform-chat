// U31 for the e2e stub API only: `GET /v1/conversations/{id}/assignees?purpose=assign|transfer` (N168, #363) as the API answers it:
// active members of the conversation's workspace (`peopleOf`) who may hold conversations, not its holder; a Sales/Support transfer,
// only those who share a team with the caller. By name, no name last; no paging, and nobody left out for being full. Never deployed.
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
      openCount: held.filter((x) => x.assignedUserId === m.userId && x.state !== 'CLOSED').length,
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
  readonly assignedUserId: string | null;
  readonly state: string;
};

/** Answers GET /v1/conversations/{id}/assignees and says true, or says false for any other route. */
export function routeAssignees(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session:
    | {
        readonly sid: string;
        readonly me: { readonly id: string; readonly org: { readonly role: string } | null } | null;
        readonly held: readonly Held[];
      }
    | null
    | undefined,
  edge: {
    readonly send: (res: ServerResponse, status: number, body: unknown) => void;
    readonly problem: (res: ServerResponse, status: number, code: string, traceId: string) => void;
  },
): boolean {
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
