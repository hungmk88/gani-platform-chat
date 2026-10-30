// #27 Tự chủ & feature flag for the e2e stub API only: `GET /v1/workspaces/{id}/autonomy` and `GET /v1/feature-flags?workspaceId=`
// as planned (docs/openapi/planned.json, N167), read by Owner and Admin. The level was last changed by the Admin, so the Owner
// reads "Người khác" and the Admin "Bạn". The empty list, an error and the 404 are given by the tests with page.route. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Autonomy, FeatureFlagList } from '../src/autonomy/autonomy';
import type { Edge } from './stub-members';

export const AUTONOMY: Autonomy = {
  level: 'L0',
  reason: 'Đợt 1 chỉ dùng L0',
  changedBy: 'user-admin',
  changedAt: '2026-10-29T17:30:00.000Z',
  available: ['L0'],
};

export const FLAGS: FeatureFlagList = {
  data: [
    {
      key: 'ai.internal',
      description: 'AI nội bộ: phân loại, tóm tắt cho nhân viên',
      enabled: true,
      locked: false,
      lockedReason: null,
    },
    {
      key: 'ai.customer_reply',
      description: 'AI trả lời khách',
      enabled: false,
      locked: true,
      lockedReason: 'phase_2',
    },
    {
      key: 'channel.zalo',
      description: 'Kênh Zalo OA',
      enabled: false,
      locked: false,
      lockedReason: null,
    },
  ],
};

/** Answers the two GETs of #27 and says true, or says false for any other route. `session` is null when signed out. */
export function routeAutonomy(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  const level = /^\/v1\/workspaces\/([^/]+)\/autonomy$/.exec(path)?.[1];
  if (req.method !== 'GET' || (!level && path !== '/v1/feature-flags')) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.role !== 'owner' && session.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const workspaceId =
    level ?? new URL(req.url ?? '/', 'http://stub').searchParams.get('workspaceId');
  if (!workspaceId?.startsWith('ws-e2e'))
    return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  edge.send(res, 200, level ? AUTONOMY : FLAGS);
  return true;
}
