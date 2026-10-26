// #21 Workspace for the e2e stub API only (N157): the workspaces of the company and changing one. Each session changes its own copy,
// so tests running side by side never see each other's changes. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Workspace } from '../src/workspaces/workspace';
import { MEMBERS, type Edge } from './stub-members';

/** The company of every session, by name; `ws-e2e` is the one `GET /v1/me` lists. */
export const WORKSPACES: readonly Workspace[] = [
  {
    id: '0190c000-0000-7000-8000-0000000000a1',
    slug: 'cskh',
    name: 'CSKH thử',
    template: 'service',
    timezone: 'Asia/Ho_Chi_Minh',
    defaultMaxConcurrent: 5,
    contactPhone: null,
    createdAt: '2026-10-01T03:00:00.000Z',
  },
  {
    id: 'ws-e2e', // the id of `GET /v1/me`, so the screens find the workspace being worked in
    slug: 'b2b',
    name: 'Workspace thử',
    template: 'b2b_sales',
    timezone: 'Asia/Ho_Chi_Minh',
    defaultMaxConcurrent: 5,
    contactPhone: null,
    createdAt: '2026-10-01T03:00:00.000Z',
  },
];

const copies = new Map<string, Workspace[]>(); // session → its workspaces
const people = new Map<string, Map<string, string[]>>(); // session → workspace id → its member ids

/** The member ids of a workspace for a session: `ws-e2e` starts with the Owner and Sales of MEMBERS, the others with none. */
export function peopleOf(sid: string, workspaceId: string): string[] {
  const start = workspaceId === 'ws-e2e' ? [MEMBERS[0]!.id, MEMBERS[2]!.id] : [];
  return people.get(sid)?.get(workspaceId) ?? start;
}

/** Answers a route of /v1/workspaces and says true, or says false for any other path. `session` is null when signed out. */
export async function routeWorkspaces(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): Promise<boolean> {
  if (path !== '/v1/workspaces' && !path.startsWith('/v1/workspaces/')) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.role !== 'owner' && session.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const mine = copies.get(session.sid) ?? WORKSPACES.map((w) => ({ ...w }));
  copies.set(session.sid, mine);
  if (req.method === 'GET' && path === '/v1/workspaces')
    return (edge.send(res, 200, { data: mine }), true);
  // The people of a workspace (N159, `peopleOf`): a PUT takes members of the company (active or suspended), not an invitation,
  // each once, at most 500, and sets the whole list.
  const staff = /^\/v1\/workspaces\/([^/]+)\/members$/.exec(path)?.[1];
  if (staff) {
    if (!mine.some((x) => x.id === staff))
      return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    const lists = people.get(session.sid) ?? new Map<string, string[]>();
    people.set(session.sid, lists);
    if (req.method === 'PUT') {
      const ids = (await edge.json(req))['memberIds'];
      const ok =
        Array.isArray(ids) &&
        ids.length <= 500 &&
        new Set(ids).size === ids.length &&
        ids.every((i) => MEMBERS.some((m) => m.id === i && m.userId));
      if (!ok) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
      lists.set(staff, ids as string[]);
    } else if (req.method !== 'GET') return false;
    const ids = peopleOf(session.sid, staff);
    const data = MEMBERS.filter((m) => ids.includes(m.id)).map((m) => ({
      memberId: m.id,
      userId: m.userId!,
      role: m.role,
    }));
    return (edge.send(res, 200, { data }), true);
  }
  // Changing one (N157): name 1–100 trimmed, a time zone this runtime knows, a limit of 1 to 100; at least one, nothing else.
  const id = /^\/v1\/workspaces\/([^/]+)$/.exec(path)?.[1];
  const w = mine.find((x) => x.id === id);
  if (req.method !== 'PATCH' || !id) return false;
  if (!w) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const body = await edge.json(req);
  const { name, timezone, defaultMaxConcurrent: limit, contactPhone: phone } = body;
  const zoneOk = (z: unknown) => {
    try {
      return (
        typeof z === 'string' && z.includes('/') && !!new Intl.DateTimeFormat('en', { timeZone: z })
      );
    } catch {
      return false;
    }
  };
  const ok =
    Object.keys(body).length > 0 &&
    Object.keys(body).every((k) =>
      ['name', 'timezone', 'defaultMaxConcurrent', 'contactPhone'].includes(k),
    ) &&
    (phone === undefined ||
      phone === null ||
      (typeof phone === 'string' && /^\+?[0-9][0-9 .-]{5,19}$/.test(phone))) &&
    (name === undefined ||
      (typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 100)) &&
    (timezone === undefined || zoneOk(timezone)) &&
    (limit === undefined ||
      (Number.isInteger(limit) && Number(limit) >= 1 && Number(limit) <= 100));
  if (!ok) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  if (typeof name === 'string') w.name = name.trim();
  if (typeof timezone === 'string') w.timezone = timezone;
  if (typeof limit === 'number') w.defaultMaxConcurrent = limit;
  if (phone !== undefined) w.contactPhone = phone;
  return (edge.send(res, 200, w), true);
}
