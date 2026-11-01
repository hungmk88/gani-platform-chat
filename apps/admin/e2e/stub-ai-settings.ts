// #26 part A for the e2e stub API only: `GET /v1/workspaces/{id}/ai-settings` as planned (docs/openapi/planned.json, #481, U61),
// Owner and Admin. 85 % of the budget spent, so the screen shows BudgetGuard's warning. The other states (100 %, 404, an error)
// are given by the tests with page.route. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AiSettings } from '../src/ai/settings';
import type { Edge } from './stub-members';

export const AI_SETTINGS: AiSettings = {
  environment: 'staging',
  features: { e1: true, l1: false },
  monthlyBudgetUsd: 200,
  usedThisMonthUsd: 170,
  resetsAt: '2026-11-30T17:00:00.000Z',
};

/** Answers the GET of #26 part A and says true, or says false for any other route. `session` is null when signed out. */
export function routeAiSettings(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  const workspaceId = /^\/v1\/workspaces\/([^/]+)\/ai-settings$/.exec(path)?.[1];
  if (req.method !== 'GET' || !workspaceId) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.role !== 'owner' && session.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  if (!workspaceId.startsWith('ws-e2e'))
    return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  return (edge.send(res, 200, AI_SETTINGS), true);
}
