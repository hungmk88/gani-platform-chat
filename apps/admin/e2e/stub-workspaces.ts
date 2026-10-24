// #21 Workspace for the e2e stub API only (N157): the workspaces of the company. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Workspace } from '../src/workspaces/workspace';
import type { Edge } from './stub-members';

/** The company of every session, by name; `Workspace thử` is the one `GET /v1/me` lists. */
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

/** Answers a route of /v1/workspaces and says true, or says false for any other path. `session` is null when signed out. */
export function routeWorkspaces(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (req.method !== 'GET' || path !== '/v1/workspaces') return false;
  if (!session) edge.problem(res, 401, 'unauthorized', 'trace-e2e-401');
  else if (session.role !== 'owner' && session.role !== 'admin')
    edge.problem(res, 403, 'forbidden', 'trace-e2e-403');
  else edge.send(res, 200, { data: WORKSPACES });
  return true;
}
