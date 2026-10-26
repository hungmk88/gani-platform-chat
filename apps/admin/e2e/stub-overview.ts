// #16 Tổng quan for the e2e stub API only: `GET /v1/overview?workspaceId=` as planned (docs/openapi/planned.json, N167). Sales and
// Support get their own figures (scope `me`); `+no-overview@` gets the 404 of an API that does not serve the route yet. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Overview } from '../src/overview/overview';
import type { Edge } from './stub-members';

export const OVERVIEW: Overview = {
  scope: 'workspace',
  openConversations: 12,
  waitingForAgent: 3,
  firstResponseP90Seconds: 220,
  overSla: null,
  agentsOnline: 4,
  agentsTotal: 7,
  generatedAt: '2026-10-26T03:05:00.000Z',
};

/** Answers GET /v1/overview and says true, or says false for any other route. `session` is null when signed out. */
export function routeOverview(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined; readonly email: string } | null,
  edge: Edge,
): boolean {
  if (req.method !== 'GET' || path !== '/v1/overview') return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  const workspaceId = new URL(req.url ?? '/', 'http://stub').searchParams.get('workspaceId');
  if (session.email.includes('+no-overview@') || !workspaceId?.startsWith('ws-e2e'))
    return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const mine = session.role === 'sales' || session.role === 'support';
  edge.send(
    res,
    200,
    mine
      ? {
          ...OVERVIEW,
          scope: 'me',
          openConversations: 2,
          waitingForAgent: 1,
          agentsOnline: null,
          agentsTotal: null,
        }
      : OVERVIEW,
  );
  return true;
}
