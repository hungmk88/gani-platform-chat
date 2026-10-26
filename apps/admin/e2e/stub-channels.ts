// The channels of a workspace and the team that answers each (N161), for the e2e stub API only: `GET /v1/channels?workspaceId=`.
// Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Channel } from '../src/channels/channels';
import type { Edge } from './stub-members';
import { TEAMS } from './stub-teams';

/** The channels `ws-e2e` has, by name: the Zalo OA answered by CSKH, the others by the default team (null). */
export const CHANNELS: readonly Channel[] = [
  {
    id: '0190c000-0000-7000-8000-0000000000c1',
    type: 'facebook',
    displayName: 'Gani Fanpage',
    status: 'connected',
    teamId: null,
  },
  {
    id: '0190c000-0000-7000-8000-0000000000c2',
    type: 'webchat',
    displayName: 'Website',
    status: 'disconnected',
    teamId: null,
  },
  {
    id: '0190c000-0000-7000-8000-0000000000c3',
    type: 'zalo_oa',
    displayName: 'Zalo OA Gani',
    status: 'token_expiring',
    teamId: TEAMS[0]!.id,
  },
];

/** Answers /v1/channels and says true, or says false for any other path. `session` is null when signed out. */
export function routeChannels(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (path !== '/v1/channels' || req.method !== 'GET') return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.role !== 'owner' && session.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const ws = new URL(req.url ?? '/', 'http://stub').searchParams.get('workspaceId');
  if (ws !== 'ws-e2e') return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  return (edge.send(res, 200, { data: CHANNELS }), true);
}
