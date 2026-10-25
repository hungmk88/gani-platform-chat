// #20 Team for the e2e stub API only (N160): the teams of a workspace and making one. Each session makes its own, so tests running
// side by side never see each other's teams. Never deployed.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Team } from '../src/teams/teams';
import type { Edge } from './stub-members';

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
    createdAt: '2026-10-01T03:00:00.000Z',
  },
];

const copies = new Map<string, Team[]>(); // session → its teams (those of TEAMS, changed, and those it made)
const byKey = new Map<string, Team>(); // Idempotency-Key → the team it made

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
  if (path !== '/v1/teams' && !id) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  const mine = copies.get(session.sid) ?? TEAMS.map((t) => ({ ...t }));
  copies.set(session.sid, mine);
  const changes = session.role === 'owner' || session.role === 'admin';
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
  const body = await edge.json(req);
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
      createdAt: new Date().toISOString(),
    };
    mine.push(team);
    byKey.set(key, team);
    return (edge.send(res, 201, team), true);
  }
  const team = mine.find((t) => t.id === id);
  if (!team) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
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
