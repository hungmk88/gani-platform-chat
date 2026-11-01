// #17 Danh sách bot flow for the e2e stub API only, as the real API serves it (openapi.json, D1a3a #496): `GET /v1/bot-flows` of a
// workspace, last changed first; Owner, Admin, Manager. The empty list, an error, the 404 and a full list are given by the tests
// with page.route. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BotFlow } from '../src/bots/bot-flows';
import type { Edge } from './stub-members';

const flow = (
  n: number,
  name: string,
  status: BotFlow['status'],
  publishedVersion: number | null,
  version: number,
  updatedAt: string,
): BotFlow => ({
  id: `0190f200-0000-7000-8000-00000000000${n}`,
  workspaceId: 'ws-e2e',
  name,
  status,
  version,
  publishedVersion,
  createdAt: '2026-10-20T02:00:00.000Z',
  updatedAt,
});

export const BOT_FLOWS: readonly BotFlow[] = [
  flow(1, 'Chào khách mới', 'active', 3, 7, '2026-10-31T03:00:00.000Z'),
  flow(2, 'Ngoài giờ', 'inactive', 1, 2, '2026-10-28T09:00:00.000Z'),
  flow(3, 'Hỏi giá sỉ', 'draft', null, 0, '2026-10-27T01:00:00.000Z'),
];

/** Answers the list of #17 and says true, or says false for any other route. `session` is null when signed out. */
export function routeBotFlows(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (req.method !== 'GET' || path !== '/v1/bot-flows') return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (!['owner', 'admin', 'manager'].includes(session.role ?? ''))
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const workspaceId = new URL(req.url ?? '/', 'http://stub').searchParams.get('workspaceId');
  if (!workspaceId) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  const data = BOT_FLOWS.filter((f) => f.workspaceId === workspaceId);
  return (edge.send(res, 200, { data }), true);
}
