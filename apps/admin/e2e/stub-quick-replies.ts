// #22 Mẫu trả lời nhanh for the e2e stub API only (N163): the templates of a workspace, most used first, making, changing, ending and previewing one,
// counting one use. Each session has its own copy, so tests running side by side never see each other's templates. Never deployed.
import { randomUUID } from 'node:crypto';
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
const WRITERS = ['owner', 'admin', 'manager'];
const VARIABLES = ['customer_name', 'agent_name', 'company_name', 'company_phone'];
const copies = new Map<string, QuickReply[]>(); // session → its templates
const byKey = new Map<string, QuickReply>(); // Idempotency-Key → the template it made

/** Answers /v1/quick-replies and says true, or says false for any other path. `session` is null when signed out. */
export async function routeQuickReplies(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): Promise<boolean> {
  const id = /^\/v1\/quick-replies\/([^/]+)$/.exec(path)?.[1];
  const used = /^\/v1\/quick-replies\/([^/]+)\/used$/.exec(path)?.[1];
  const preview = /^\/v1\/quick-replies\/([^/]+)\/preview$/.exec(path)?.[1];
  if (path !== '/v1/quick-replies' && !id && !used && !preview) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (!READERS.includes(session.role ?? ''))
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const mine = copies.get(session.sid) ?? QUICK_REPLIES.map((r) => ({ ...r, tags: [...r.tags] }));
  copies.set(session.sid, mine);
  if (used) {
    // The Inbox sent it (C7c2): every role that reads templates counts one use.
    const r = mine.find((x) => x.id === used);
    if (req.method !== 'POST') return false;
    if (!r) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    r.useCount += 1;
    return (edge.send(res, 200, { useCount: r.useCount }), true);
  }
  if (preview) {
    // Seen with sample values (C7c3): only who manages templates; `ws-e2e` has no contact number, so {{company_phone}} stays.
    if (!WRITERS.includes(session.role ?? ''))
      return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
    const r = mine.find((x) => x.id === preview);
    if (req.method !== 'POST') return false;
    if (!r) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    const values: Record<string, string> = {
      customer_name: 'Nguyễn Văn A',
      agent_name: `Người thử ${session.role ?? ''}`,
      company_name: 'Công ty thử',
    };
    const unresolved = new Set<string>();
    const text = r.body.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (whole, name: string) => {
      if (values[name]) return values[name];
      unresolved.add(name);
      return whole;
    });
    return (edge.send(res, 200, { text, unresolved: [...unresolved] }), true);
  }
  if (id) {
    // Changing or ending one (C7b2): only Owner, Admin, Manager; a shortcut once per workspace; at least one field to change.
    if (!WRITERS.includes(session.role ?? ''))
      return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
    const r = mine.find((x) => x.id === id);
    if (!r) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    if (req.method === 'DELETE') {
      mine.splice(mine.indexOf(r), 1);
      res.writeHead(204).end();
      return true;
    }
    if (req.method !== 'PATCH') return false;
    const change = await edge.json(req);
    const { shortcut, body, tags } = change;
    const ok =
      Object.keys(change).length > 0 &&
      Object.keys(change).every((k) => ['shortcut', 'body', 'tags'].includes(k)) &&
      (shortcut === undefined ||
        (typeof shortcut === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(shortcut))) &&
      (body === undefined || (typeof body === 'string' && body.trim() !== '')) &&
      (tags === undefined || Array.isArray(tags));
    if (!ok) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
    if (typeof shortcut === 'string' && mine.some((x) => x !== r && x.shortcut === shortcut))
      return (edge.problem(res, 409, 'duplicate_resource', 'trace-e2e-409'), true);
    if (typeof shortcut === 'string') r.shortcut = shortcut;
    if (typeof body === 'string') r.body = body;
    if (Array.isArray(tags)) r.tags = tags as string[];
    r.updatedAt = new Date().toISOString();
    return (edge.send(res, 200, r), true);
  }
  if (req.method === 'POST') {
    // Making one (C7b1): only Owner, Admin, Manager; the checks of the API; a shortcut once per workspace.
    if (!WRITERS.includes(session.role ?? ''))
      return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
    const key = req.headers['idempotency-key'];
    const done = typeof key === 'string' ? byKey.get(key) : undefined;
    if (done) return (edge.send(res, 201, done), true);
    const { workspaceId, shortcut, body, tags = [] } = await edge.json(req);
    const names = typeof body === 'string' ? [...body.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)] : [];
    const ok =
      typeof key === 'string' &&
      typeof shortcut === 'string' &&
      /^[a-z0-9][a-z0-9_-]{0,31}$/.test(shortcut) &&
      typeof body === 'string' &&
      body.trim() !== '' &&
      body.length <= 2000 &&
      names.every((m) => VARIABLES.includes(m[1] ?? '')) &&
      Array.isArray(tags) &&
      tags.length <= 10 &&
      new Set(tags).size === tags.length;
    if (!ok) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
    if (workspaceId !== 'ws-e2e')
      return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    if (mine.some((r) => r.shortcut === shortcut))
      return (edge.problem(res, 409, 'duplicate_resource', 'trace-e2e-409'), true);
    const now = new Date().toISOString();
    const made: QuickReply = {
      id: randomUUID(),
      workspaceId,
      shortcut,
      body,
      tags: tags as string[],
      useCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mine.push(made);
    byKey.set(key, made);
    return (edge.send(res, 201, made), true);
  }
  if (req.method !== 'GET') return false;
  const query = new URL(req.url ?? '/', 'http://stub').searchParams;
  if (query.get('workspaceId') !== 'ws-e2e')
    return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const q = query.get('q') ?? '';
  const tag = query.get('tag');
  const data = mine.filter((r) => r.shortcut.startsWith(q) && (!tag || r.tags.includes(tag)));
  return (edge.send(res, 200, { data }), true);
}
