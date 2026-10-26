// #22 Mẫu trả lời nhanh for the e2e stub API only (N163): the templates of a workspace, most used first. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { QuickReply } from '../src/quick-replies/quick-replies';
import type { Edge } from './stub-members';

const at = '2026-10-20T03:00:00.000Z';
/** The templates `ws-e2e` has, most used first as the API sorts them. */
export const QUICK_REPLIES: readonly QuickReply[] = [
  {
    id: '0190c000-0000-7000-8000-0000000000d1',
    workspaceId: 'ws-e2e',
    shortcut: 'chao',
    body: 'Chào {{customer_name}}, em là {{agent_name}} của {{company_name}}.\nEm hỗ trợ được gì ạ?',
    tags: ['mở đầu'],
    useCount: 42,
    createdAt: at,
    updatedAt: at,
  },
  {
    id: '0190c000-0000-7000-8000-0000000000d2',
    workspaceId: 'ws-e2e',
    shortcut: 'gia-si',
    body: 'Giá sỉ theo số lượng, anh/chị gọi {{company_phone}} để được báo giá.',
    tags: ['báo giá', 'sỉ'],
    useCount: 7,
    createdAt: at,
    updatedAt: at,
  },
  {
    id: '0190c000-0000-7000-8000-0000000000d3',
    workspaceId: 'ws-e2e',
    shortcut: 'giao-hang',
    body: 'Đơn nội thành giao trong ngày.',
    tags: [],
    useCount: 0,
    createdAt: at,
    updatedAt: at,
  },
];

const READERS = ['owner', 'admin', 'manager', 'sales', 'support'];

/** Answers /v1/quick-replies and says true, or says false for any other path. `session` is null when signed out. */
export function routeQuickReplies(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (path !== '/v1/quick-replies' || req.method !== 'GET') return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (!READERS.includes(session.role ?? ''))
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const query = new URL(req.url ?? '/', 'http://stub').searchParams;
  if (query.get('workspaceId') !== 'ws-e2e')
    return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const q = query.get('q') ?? '';
  const tag = query.get('tag');
  const data = QUICK_REPLIES.filter(
    (r) => r.shortcut.startsWith(q) && (!tag || r.tags.includes(tag)),
  );
  return (edge.send(res, 200, { data }), true);
}
