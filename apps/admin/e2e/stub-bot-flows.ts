// #17 Danh sách bot flow for the e2e stub API only, as the real API serves it (openapi.json, D1a3a #496): `GET /v1/bot-flows` of a
// workspace, last changed first, and `GET /v1/bot-flows/{id}` with the draft and the version published last; Owner, Admin, Manager.
// Read only. The empty list, an error, the 404 and a full list are given by the tests with page.route. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BotFlow, BotFlowDetail } from '../src/bots/bot-flows';
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

type Graph = BotFlowDetail['draft']['graph'];
const version = (n: number, v: number | null, at: string | null, graph: Graph) => ({
  id: `0190f200-0000-7000-8000-0000000000${n}`,
  status: v === null ? ('draft' as const) : ('published' as const),
  version: v,
  publishedAt: at,
  graph,
});
const GREETING: Graph = {
  nodes: [
    { key: 'start', type: 'trigger', config: { on: 'first_message' } },
    { key: 'hello', type: 'message', config: { text: 'Chào anh/chị, Gani Foods xin nghe.' } },
    { key: 'done', type: 'end', config: {} },
  ],
  edges: [
    { from: 'start', to: 'hello', label: null },
    { from: 'hello', to: 'done', label: null },
  ],
};
// The two versions the detail adds to each flow of BOT_FLOWS, in the same order.
const VERSIONS: readonly Pick<BotFlowDetail, 'draft' | 'published'>[] = [
  {
    published: version(11, 3, '2026-10-30T02:30:00.000Z', GREETING),
    // The draft asks the customer's need after the greeting: changed since version 3.
    draft: version(12, null, null, {
      nodes: [
        ...GREETING.nodes,
        {
          key: 'need',
          type: 'question',
          config: { text: 'Anh/chị cần gì?', kind: 'text', variable: 'need' },
        },
      ],
      edges: [...GREETING.edges, { from: 'hello', to: 'need', label: 'Hỏi thêm' }],
    }),
  },
  {
    published: version(21, 1, '2026-10-28T08:59:00.000Z', GREETING),
    draft: version(22, null, null, GREETING),
  },
  { published: null, draft: version(31, null, null, { nodes: [], edges: [] }) },
];

/** Answers the reads of #17 and says true, or says false for any other route. `session` is null when signed out. */
export function routeBotFlows(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  const one = /^\/v1\/bot-flows\/([^/]+)$/.exec(path);
  if (req.method !== 'GET' || (path !== '/v1/bot-flows' && !one)) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (!['owner', 'admin', 'manager'].includes(session.role ?? ''))
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  if (one) {
    const n = BOT_FLOWS.findIndex((f) => f.id === one[1]);
    if (n < 0) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    return (
      edge.send(res, 200, { ...BOT_FLOWS[n]!, ...VERSIONS[n]! } satisfies BotFlowDetail),
      true
    );
  }
  const workspaceId = new URL(req.url ?? '/', 'http://stub').searchParams.get('workspaceId');
  if (!workspaceId) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  const data = BOT_FLOWS.filter((f) => f.workspaceId === workspaceId);
  return (edge.send(res, 200, { data }), true);
}
