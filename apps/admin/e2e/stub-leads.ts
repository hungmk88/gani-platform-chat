// #12 Pipeline lead for the e2e stub API only, on the contract planned for S4 (docs/openapi/planned.json, #544; src/leads/leads.ts):
// `GET /v1/workspaces/{id}/pipeline` and `GET /v1/leads` of a workspace, by cursor, and `GET /v1/leads/{id}` with its history
// (#13a). Every role of the company reads them but Support (T-2, 403). The steps and the reason a lead is lost are placeholders, "chờ Q9, dữ liệu tạm",
// as the API would give them. The empty board, errors and the 404 of an API that does not serve the routes
// yet are given by the tests with page.route. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { LeadDetail, LeadEvent } from '../src/leads/lead-detail';
import type { Lead, PipelineStage } from '../src/leads/leads';
import type { Edge } from './stub-members';

export const STAGES: readonly PipelineStage[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `stage-${n}`,
  name: `Bước ${n} (chờ Q9, dữ liệu tạm)`,
  position: n - 1,
}));
export const LOST_REASON = 'Lý do tạm (chờ Q9, dữ liệu tạm)';

const at = (n: number) => `2026-10-2${9 - n}T03:00:00.000Z`;
const lead = (
  n: number,
  title: string,
  customer: string | null,
  stage: number,
  status: Lead['status'] = 'open',
  owner: string | null = 'sales',
): Lead => ({
  id: `0190d400-0000-7000-8000-00000000000${n}`,
  workspaceId: 'ws-e2e',
  customer: { id: `0190d401-0000-7000-8000-00000000000${n}`, displayName: customer },
  conversationId: null,
  title,
  stage: STAGES[stage - 1]!,
  status,
  owner: owner ? { id: `user-${owner}`, name: `Người thử ${owner}` } : null,
  createdBy: 'user-sales',
  lostReason: status === 'lost' ? LOST_REASON : null,
  closedAt: status === 'open' ? null : at(n),
  score: null,
  version: 1,
  createdAt: '2026-10-20T03:00:00.000Z',
  updatedAt: at(n),
});

/** The leads of the stub's workspace, last changed first. */
export const LEADS: readonly Lead[] = [
  lead(1, 'Báo giá phở khô', 'Quán Phở Hà Nội', 1),
  lead(2, 'Hỏi giá sỉ', 'Nhà hàng Sen', 1, 'open', null),
  lead(3, 'Đại lý cấp 2', 'Đại lý Bình Minh', 2, 'open', 'manager'),
  lead(4, 'Hỏi sản phẩm mới', null, 3),
  lead(5, 'Suất ăn công ty', 'Bếp ăn Tân Phú', 6),
  lead(6, 'Đơn hàng tháng 11', 'Nhà hàng Đông Á', 6, 'won'),
  lead(7, 'Thực đơn chay', 'Quán Chay An Lạc', 4, 'lost', 'manager'),
];
/** The page size of the stub's list, small so that "Tải thêm" is tested. */
export const LEADS_PAGE = 5;

/** #13a: a lead with its history, oldest first: made by Sales at the first step, moved there by its owner, closed by a Manager. */
export function detailOf(l: Lead): LeadDetail {
  const stage = (s: PipelineStage) => ({ id: s.id, name: s.name });
  const event = (e: Partial<LeadEvent> & Pick<LeadEvent, 'type'>): LeadEvent => ({
    fromStage: null,
    toStage: null,
    outcome: null,
    actorUserId: 'user-sales',
    occurredAt: l.createdAt,
    ...e,
  });
  const events = [event({ type: 'created', toStage: stage(STAGES[0]!) })];
  if (l.stage.id !== STAGES[0]!.id)
    events.push(
      event({
        type: 'stage_changed',
        fromStage: stage(STAGES[0]!),
        toStage: l.stage,
        actorUserId: l.owner?.id ?? null,
        occurredAt: l.updatedAt,
      }),
    );
  if (l.status !== 'open')
    events.push(
      event({
        type: 'closed',
        outcome: l.status,
        actorUserId: 'user-manager',
        occurredAt: l.closedAt ?? l.updatedAt,
      }),
    );
  return { ...l, events };
}

/** Answers the reads of #12 and says true, or says false for any other route. `session` is null when signed out. */
export function routeLeads(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  const pipeline = /^\/v1\/workspaces\/([^/]+)\/pipeline$/.exec(path);
  const one = /^\/v1\/leads\/([^/]+)$/.exec(path);
  if (req.method !== 'GET' || (path !== '/v1/leads' && !pipeline && !one)) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  // T-2 (N188, CEO 03/11): Support 403 like the other roles outside the company.
  if (!session.role || session.role === 'platform_operator' || session.role === 'support')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  if (one) {
    const l = LEADS.find((x) => x.id === decodeURIComponent(one[1]!));
    return (
      l ? edge.send(res, 200, detailOf(l)) : edge.problem(res, 404, 'not_found', 'trace-e2e-404'),
      true
    );
  }
  if (pipeline)
    return (
      edge.send(res, 200, {
        data: pipeline[1] === 'ws-e2e' ? STAGES : [],
        lostReasons: [LOST_REASON],
      }),
      true
    );
  const q = new URL(req.url ?? '/', 'http://stub').searchParams;
  const ws = q.get('workspaceId');
  const customerId = q.get('customerId'); // #8 (P3): the leads of one customer, every workspace of the session
  if (!ws && !customerId)
    return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  const all = LEADS.filter(
    (l) => (!ws || l.workspaceId === ws) && (!customerId || l.customer.id === customerId),
  );
  const from = Number(q.get('cursor') ?? 0);
  const to = from + LEADS_PAGE;
  return (
    edge.send(res, 200, {
      data: all.slice(from, to),
      nextCursor: to < all.length ? String(to) : null,
    }),
    true
  );
}
