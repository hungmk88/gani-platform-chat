// #26 for the e2e stub API only: `GET/PATCH /v1/workspaces/{id}/ai-settings` as planned (docs/openapi/planned.json, #481, U61),
// Owner and Admin, each session on its own copy. 85 % of the budget spent, so the screen shows BudgetGuard's warning; `+ai-prod`
// starts in `production`. PATCH: only the known fields, at least one (400 otherwise); `production` is the Owner's alone (403 for
// the Admin) and locked by Q1 (409 `ai_production_locked`). The other states are given by the tests with page.route. Never deployed.
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

const copies = new Map<string, AiSettings>(); // session cookie → its settings

/** The PATCH body as the contract takes it (`AiSettingsChange`), or null. */
function changeOf(body: Record<string, unknown>): Partial<AiSettings> | null {
  const keys = Object.keys(body);
  if (
    keys.length === 0 ||
    keys.some((k) => !['environment', 'features', 'monthlyBudgetUsd'].includes(k))
  )
    return null;
  const { environment, features, monthlyBudgetUsd: budget } = body;
  if (environment !== undefined && environment !== 'staging' && environment !== 'production')
    return null;
  if (budget !== undefined && (typeof budget !== 'number' || budget < 0 || budget > 1_000_000))
    return null;
  if (features !== undefined) {
    if (typeof features !== 'object' || features === null) return null;
    const f = Object.entries(features);
    if (f.some(([k, v]) => !['e1', 'l1'].includes(k) || typeof v !== 'boolean')) return null;
  }
  return body;
}

/** Answers the routes of #26 ai-settings and says true, or says false for any other route. `who` is null when signed out. */
export async function routeAiSettings(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  who: { readonly sid: string; readonly role: string | undefined; readonly email: string } | null,
  edge: Edge,
): Promise<boolean> {
  const workspaceId = /^\/v1\/workspaces\/([^/]+)\/ai-settings$/.exec(path)?.[1];
  if (!workspaceId || (req.method !== 'GET' && req.method !== 'PATCH')) return false;
  if (!who) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (who.role !== 'owner' && who.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  if (!workspaceId.startsWith('ws-e2e'))
    return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const mine = copies.get(who.sid) ?? {
    ...structuredClone(AI_SETTINGS),
    ...(who.email.includes('+ai-prod') ? { environment: 'production' as const } : {}),
  };
  copies.set(who.sid, mine);
  if (req.method === 'PATCH') {
    const change = changeOf(await edge.json(req));
    if (!change) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
    if (change.environment === 'production' && who.role !== 'owner')
      return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
    if (change.environment === 'production')
      return (edge.problem(res, 409, 'ai_production_locked', 'trace-e2e-409'), true);
    copies.set(who.sid, {
      ...mine,
      ...change,
      features: { ...mine.features, ...change.features },
    });
  }
  return (edge.send(res, 200, copies.get(who.sid)), true);
}
