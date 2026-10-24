// #21 Workspace for the e2e stub API only (N157): the workspaces of the company and changing one. Each session changes its own copy,
// so tests running side by side never see each other's changes. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Workspace } from '../src/workspaces/workspace';
import type { Edge } from './stub-members';

/** The company of every session, by name; `ws-e2e` is the one `GET /v1/me` lists. */
export const WORKSPACES: readonly Workspace[] = [
  {
    id: '0190c000-0000-7000-8000-0000000000a1',
    slug: 'cskh',
    name: 'CSKH thử',
    template: 'service',
    timezone: 'Asia/Ho_Chi_Minh',
    defaultMaxConcurrent: 5,
    createdAt: '2026-10-01T03:00:00.000Z',
  },
  {
    id: '0190c000-0000-7000-8000-0000000000a2',
    slug: 'b2b',
    name: 'Workspace thử',
    template: 'b2b_sales',
    timezone: 'Asia/Ho_Chi_Minh',
    defaultMaxConcurrent: 5,
    createdAt: '2026-10-01T03:00:00.000Z',
  },
];

const copies = new Map<string, Workspace[]>(); // session → its workspaces

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
  // Changing one (N157): name 1–100 trimmed, a time zone this runtime knows, a limit of 1 to 100; at least one, nothing else.
  const id = /^\/v1\/workspaces\/([^/]+)$/.exec(path)?.[1];
  const w = mine.find((x) => x.id === id);
  if (req.method !== 'PATCH' || !id) return false;
  if (!w) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const body = await edge.json(req);
  const { name, timezone, defaultMaxConcurrent: limit } = body;
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
    Object.keys(body).every((k) => ['name', 'timezone', 'defaultMaxConcurrent'].includes(k)) &&
    (name === undefined ||
      (typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 100)) &&
    (timezone === undefined || zoneOk(timezone)) &&
    (limit === undefined ||
      (Number.isInteger(limit) && Number(limit) >= 1 && Number(limit) <= 100));
  if (!ok) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  if (typeof name === 'string') w.name = name.trim();
  if (typeof timezone === 'string') w.timezone = timezone;
  if (typeof limit === 'number') w.defaultMaxConcurrent = limit;
  return (edge.send(res, 200, w), true);
}
