// The channels of a workspace and the team that answers each (N161), for the e2e stub API only: `GET /v1/channels?workspaceId=`
// and `PUT /v1/teams/{id}/channels`. Each session has its own copy, so tests running side by side never see each other's changes.
// Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Channel } from '../src/teams/team-channels';
import type { Edge } from './stub-members';
import { TEAMS, teamsOf } from './stub-teams';

/** The channels `ws-e2e` starts with, by name: the Zalo OA answered by CSKH, the others by the default team (null). */
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

const copies = new Map<string, Channel[]>(); // session → the channels of ws-e2e

/** Answers /v1/channels and /v1/teams/{id}/channels and says true, or says false for any other path. */
export async function routeChannels(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): Promise<boolean> {
  const of = /^\/v1\/teams\/([^/]+)\/channels$/.exec(path)?.[1];
  if (path !== '/v1/channels' && !of) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.role !== 'owner' && session.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const mine = copies.get(session.sid) ?? CHANNELS.map((c) => ({ ...c }));
  copies.set(session.sid, mine);
  if (req.method === 'GET' && !of) {
    const ws = new URL(req.url ?? '/', 'http://stub').searchParams.get('workspaceId');
    if (ws !== 'ws-e2e') return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    return (edge.send(res, 200, { data: mine }), true);
  }
  if (req.method !== 'PUT' || !of) return false;
  // A channel of another team moves to this one; one of this team left out goes back to the default team (null).
  const team = teamsOf(session.sid).find((t) => t.id === of);
  if (!team) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const ids = (await edge.json(req))['channelIds'];
  const ok =
    Array.isArray(ids) &&
    ids.length <= 200 &&
    new Set(ids).size === ids.length &&
    ids.every((i) => mine.some((c) => c.id === i));
  if (!ok) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  for (const c of mine)
    c.teamId = ids.includes(c.id) ? team.id : c.teamId === team.id ? null : c.teamId;
  return (edge.send(res, 200, team), true);
}
