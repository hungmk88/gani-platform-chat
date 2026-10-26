// #20 Team for the e2e stub API only (N160): the teams of a workspace, making, changing and ending one, picking its people. Each session
// has its own copy, so tests running side by side never see each other's teams. Never deployed.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Team } from '../src/teams/teams';
import { MEMBERS, type Edge } from './stub-members';
import { peopleOf } from './stub-workspaces';

/** The teams `ws-e2e` starts with, by name. */
export const TEAMS: readonly Team[] = [
  {
    id: '0190c000-0000-7000-8000-0000000000b1',
    workspaceId: 'ws-e2e',
    name: 'CSKH',
    slug: 'cskh',
    description: 'Sau bán hàng, khiếu nại',
    isDefault: false,
    memberCount: 1,
    channelIds: [],
    createdAt: '2026-10-01T03:00:00.000Z',
  },
  {
    id: '0190c000-0000-7000-8000-0000000000b2',
    workspaceId: 'ws-e2e',
    name: 'Sales B2B',
    slug: 'sales-b2b',
    description: null,
    isDefault: true,
    memberCount: 2,
    channelIds: [],
    createdAt: '2026-10-01T03:00:00.000Z',
  },
];

const copies = new Map<string, Team[]>(); // session → its teams (those of TEAMS, changed or ended, and those it made)
const byKey = new Map<string, Team>(); // Idempotency-Key → the team it made
const people = new Map<string, Map<string, string[]>>(); // session → team id → its member ids
/** The people each team of TEAMS starts with, as its memberCount says: Sales for CSKH, the Owner and Sales for Sales B2B. */
const START: Record<string, string[]> = {
  [TEAMS[0]!.id]: [MEMBERS[2]!.id],
  [TEAMS[1]!.id]: [MEMBERS[0]!.id, MEMBERS[2]!.id],
};

/** The slug the API makes: no accents, đ → d, words joined by "-", a taken one gets -2, -3… */
function slugOf(name: string, taken: readonly string[]): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  let slug = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
  return slug;
}

const byName = (a: Team, b: Team) => a.name.localeCompare(b.name, 'vi');

/** Answers a route of /v1/teams and says true, or says false for any other path. `session` is null when signed out. */
export async function routeTeams(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): Promise<boolean> {
  const id = /^\/v1\/teams\/([^/]+)$/.exec(path)?.[1];
  const staffOf = /^\/v1\/teams\/([^/]+)\/members$/.exec(path)?.[1];
  if (path !== '/v1/teams' && !id && !staffOf) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  const mine = copies.get(session.sid) ?? TEAMS.map((t) => ({ ...t }));
  copies.set(session.sid, mine);
  const changes = session.role === 'owner' || session.role === 'admin';
  if (staffOf) {
    // The people of a team (A4-T2c): a PUT takes people of the team's workspace, each once, at most 500, and sets the whole list.
    if (!changes) return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
    const team = mine.find((t) => t.id === staffOf);
    if (!team) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    const lists = people.get(session.sid) ?? new Map<string, string[]>();
    people.set(session.sid, lists);
    if (req.method === 'PUT') {
      const ids = (await edge.json(req))['memberIds'];
      const staff = peopleOf(session.sid, team.workspaceId);
      const ok =
        Array.isArray(ids) &&
        ids.length <= 500 &&
        new Set(ids).size === ids.length &&
        ids.every((i) => staff.includes(i as string));
      if (!ok) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
      lists.set(team.id, ids as string[]);
      team.memberCount = ids.length;
    } else if (req.method !== 'GET') return false;
    const ids = lists.get(team.id) ?? START[team.id] ?? [];
    const data = MEMBERS.filter((m) => ids.includes(m.id)).map((m) => ({
      memberId: m.id,
      userId: m.userId!,
      role: m.role,
    }));
    return (edge.send(res, 200, { data }), true);
  }
  if (req.method === 'GET' && !id) {
    if (!changes && session.role !== 'manager')
      return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
    const ws = new URL(req.url ?? '/', 'http://stub').searchParams.get('workspaceId');
    return (
      edge.send(res, 200, { data: mine.filter((t) => t.workspaceId === ws).sort(byName) }),
      true
    );
  }
  if (!changes) return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const body = req.method === 'DELETE' ? {} : await edge.json(req);
  const name = typeof body['name'] === 'string' ? body['name'].trim() : undefined;
  const description =
    typeof body['description'] === 'string'
      ? body['description'].trim() || null
      : body['description'];
  const bad =
    (name !== undefined && (!name || name.length > 100)) ||
    (typeof description === 'string' && description.length > 500);
  if (bad) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  if (req.method === 'POST' && !id) {
    // Making one (A4-T2a): one Idempotency-Key per request; the slug made from the name.
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !name)
      return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
    const done = byKey.get(key);
    if (done) return (edge.send(res, 201, done), true);
    if (body['workspaceId'] !== 'ws-e2e')
      return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    const team: Team = {
      id: randomUUID(),
      workspaceId: 'ws-e2e',
      name,
      slug: slugOf(
        name,
        mine.map((t) => t.slug),
      ),
      description: (description as string | null | undefined) ?? null,
      isDefault: false,
      memberCount: 0,
      channelIds: [],
      createdAt: new Date().toISOString(),
    };
    mine.push(team);
    byKey.set(key, team);
    return (edge.send(res, 201, team), true);
  }
  const team = mine.find((t) => t.id === id);
  if (!team) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  if (req.method === 'DELETE') {
    // Ending one (A4-T2b): the default team of a workspace stays.
    if (team.isDefault) return (edge.problem(res, 409, 'team_in_use', 'trace-e2e-409'), true);
    mine.splice(mine.indexOf(team), 1);
    res.writeHead(204).end();
    return true;
  }
  if (req.method !== 'PATCH') return false;
  // Changing one (A4-T2b): at least one field; made the default, the old default of the workspace loses the flag.
  const keys = Object.keys(body);
  if (!keys.length || keys.some((k) => !['name', 'description', 'isDefault'].includes(k)))
    return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  if (name !== undefined) team.name = name;
  if (description !== undefined) team.description = description as string | null;
  if (body['isDefault'] === true)
    for (const t of mine)
      t.isDefault = t.workspaceId === team.workspaceId ? t === team : t.isDefault;
  return (edge.send(res, 200, team), true);
}
