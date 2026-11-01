// #28 Audit log for the e2e stub API only: `GET /v1/audit-logs` as the real API serves it (openapi.json, A9a #478, A9b #480),
// Owner and Admin. Rows are dated back from AUDIT_NOW, the time e2e/audit.spec.ts fixes the browser's clock to, so the screen's 7
// days hold them whatever the machine's clock says (01/11: a test on the machine's clock can break at Viet Nam's midnight or when
// the clock is off); the filters and the cursor work as the API's: page 1 is 3 rows, page 2 repeats its last row (a row written
// between the two would make it). A query the API refuses is a 400 `validation_failed`. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AuditLog } from '../src/audit/audit';
import type { Edge } from './stub-members';

/** 31/10/2026 12:00 in Viet Nam: the "now" of the audit e2e, for the stub's rows and the browser's clock alike. */
export const AUDIT_NOW = Date.parse('2026-10-31T05:00:00.000Z');

const id = (n: number) => `0190f100-0000-7000-8000-${String(n).padStart(12, '0')}`;
/** Someone who is not the person signed in: the screen names them by the last 8 characters. */
export const OTHER = '0190f100-0000-7000-8000-00009abcdef0';

const row = (
  n: number,
  hoursAgo: number,
  actorUserId: string | null,
  action: string,
  targetType: string | null,
  detail: AuditLog['detail'],
): Omit<AuditLog, 'createdAt'> & { hoursAgo: number } => ({
  id: id(n),
  actorUserId,
  action,
  targetType,
  targetId: targetType ? id(100 + n) : null,
  detail,
  hoursAgo,
});

const ROWS = [
  row(1, 1, 'user-owner', 'member.role_changed', 'member', { from: 'sales', to: 'manager' }),
  row(2, 5, OTHER, 'member.two_factor_reset', 'member', { reason: '<b>Khách mất máy</b>' }),
  row(3, 30, null, 'workspace.updated', 'workspace', {}),
  row(4, 50, 'user-owner', 'team.created', 'team', { members: ['a', 'b'] }),
  row(5, 70, OTHER, 'customer.updated', 'customer', { fields: 2 }),
];

const KNOWN = new Set(['actorUserId', 'action', 'targetType', 'from', 'to', 'limit', 'cursor']);
const ACTION = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const TARGET_TYPE = /^[a-z][a-z0-9_]{0,63}$/;

/** Answers the route of #28 and says true, or says false for any other route. `session` is null when signed out. */
export function routeAudit(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (path !== '/v1/audit-logs' || req.method !== 'GET') return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.role !== 'owner' && session.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const q = new URL(req.url ?? '/', 'http://stub').searchParams;
  const bad = () => (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  if ([...q.keys()].some((k) => !KNOWN.has(k))) return bad();
  const action = q.get('action');
  const targetType = q.get('targetType');
  const from = q.get('from');
  const to = q.get('to');
  const cursor = q.get('cursor');
  if (action !== null && !ACTION.test(action)) return bad();
  if (targetType !== null && !TARGET_TYPE.test(targetType)) return bad();
  if (from && to && Date.parse(from) >= Date.parse(to)) return bad();
  if (cursor !== null && cursor !== 'trang-2') return bad();
  const now = AUDIT_NOW;
  const rows: AuditLog[] = ROWS.map(({ hoursAgo, ...r }) => ({
    ...r,
    createdAt: new Date(now - hoursAgo * 3_600_000).toISOString(),
  })).filter(
    (r) =>
      (!q.get('actorUserId') || r.actorUserId === q.get('actorUserId')) &&
      (!action || r.action === action) &&
      (!targetType || r.targetType === targetType) &&
      (!from || r.createdAt >= new Date(from).toISOString()) &&
      (!to || r.createdAt < new Date(to).toISOString()),
  );
  const page = cursor ? rows.slice(2) : rows.slice(0, 3);
  return (
    edge.send(res, 200, { data: page, nextCursor: !cursor && rows.length > 3 ? 'trang-2' : null }),
    true
  );
}
