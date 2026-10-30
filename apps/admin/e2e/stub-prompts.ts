// #26 AI nội bộ for the e2e stub API only: `GET /v1/ai/prompts` as planned (docs/openapi/planned.json, N167), read by Owner and
// Admin. The empty list, an error and the 404 of an API without the route are given by the tests with page.route. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { PromptVersionList } from '../src/ai/prompts';
import type { Edge } from './stub-members';

export const PROMPTS: PromptVersionList = {
  data: [
    {
      key: 'sales.reply',
      version: '3',
      active: true,
      approvedAt: '2026-10-29T17:30:00.000Z',
      approvedBy: 'Nguyễn An',
    },
    {
      key: 'sales.reply',
      version: '2',
      active: false,
      approvedAt: '2026-10-20T02:00:00.000Z',
      approvedBy: 'Nguyễn An',
    },
    { key: 'support.reply', version: '1', active: false, approvedAt: null, approvedBy: null },
  ],
};

/** Answers GET /v1/ai/prompts and says true, or says false for any other route. `session` is null when signed out. */
export function routeAiPrompts(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (req.method !== 'GET' || path !== '/v1/ai/prompts') return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.role !== 'owner' && session.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  edge.send(res, 200, PROMPTS);
  return true;
}
