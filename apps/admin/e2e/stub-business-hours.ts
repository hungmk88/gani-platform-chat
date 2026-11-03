// #21 Workspace, tab "Giờ làm việc" for the e2e stub API only: `GET/PUT /v1/workspaces/{id}/business-hours` as the real API (#566,
// N192), Owner and Admin, each session on its own copy. Until a PUT, the default week (Mon–Fri 08:00–18:00) with `isDefault`. The
// PUT checks as `business-hours.schemas.ts` (400 `validation_failed` otherwise). The other states are given by the tests with
// page.route. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import { NO_HOURS, type BusinessDay, type BusinessHours } from '../src/workspaces/hours';
import type { Edge } from './stub-members';
import { WORKSPACES } from './stub-workspaces';

const day = (weekday: number): BusinessDay =>
  weekday <= 5
    ? { weekday, open: true, ...NO_HOURS, opensAt: '08:00', closesAt: '18:00' }
    : { weekday, open: false, ...NO_HOURS };

const WEEK: readonly BusinessDay[] = [1, 2, 3, 4, 5, 6, 7].map(day);

const weeks = new Map<string, Map<string, BusinessDay[]>>(); // session → workspace id → its week

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hour = (v: unknown) => v === null || (typeof v === 'string' && HHMM.test(v));

/** The week as the API takes it (exactly 7 days, each weekday once, the rules of a day), or null. */
function weekOf(body: Record<string, unknown>): BusinessDay[] | null {
  const week = body['week'];
  if (Object.keys(body).length !== 1 || !Array.isArray(week) || week.length !== 7) return null;
  const days = week as Record<string, unknown>[];
  if (new Set(days.map((d) => d['weekday'])).size !== 7) return null;
  const ok = days.every((d) => {
    const { weekday: w, open } = d;
    const hours = [d['opensAt'], d['closesAt'], d['breakStartsAt'], d['breakEndsAt']];
    if (!Number.isInteger(w) || Number(w) < 1 || Number(w) > 7 || typeof open !== 'boolean')
      return false;
    if (!hours.every(hour)) return false;
    const [o, c, b, e] = hours as (string | null)[];
    if (!open) return o === null && c === null && b === null && e === null;
    if (!o || !c || !(o < c)) return false;
    if (b === null && e === null) return true;
    return !!b && !!e && o < b && b < e && e < c;
  });
  return ok ? (days as unknown as BusinessDay[]) : null;
}

/** Answers the route of business hours and says true, or says false for any other route. `who` is null when signed out. */
export async function routeBusinessHours(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  who: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): Promise<boolean> {
  const id = /^\/v1\/workspaces\/([^/]+)\/business-hours$/.exec(path)?.[1];
  if (!id || (req.method !== 'GET' && req.method !== 'PUT')) return false;
  if (!who) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (who.role !== 'owner' && who.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const w = WORKSPACES.find((x) => x.id === id);
  if (!w) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const mine = weeks.get(who.sid) ?? new Map<string, BusinessDay[]>();
  weeks.set(who.sid, mine);
  if (req.method === 'PUT') {
    const week = weekOf(await edge.json(req));
    if (!week) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
    mine.set(
      id,
      [...week].sort((a, b) => a.weekday - b.weekday),
    );
  }
  const set = mine.get(id);
  const hours: BusinessHours = { timezone: w.timezone, isDefault: !set, week: set ?? [...WEEK] };
  return (edge.send(res, 200, hours), true);
}
