// #21 Workspace, tab "Ngày nghỉ" for the e2e stub API only: `GET/POST /v1/workspaces/{id}/holidays`, `PATCH/DELETE
// …/holidays/{hid}` as the real API (#570, #571), Owner and Admin, each session on its own copy. Checks as holidays.schemas.ts
// (400), then 422 holiday_in_past (ends before today, Asia/Ho_Chi_Minh) and holiday_overlap (meets another day off). A POST
// without Idempotency-Key is a 400, as the API. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Holiday } from '../src/workspaces/holidays';
import type { Edge } from './stub-members';
import { WORKSPACES } from './stub-workspaces';

/** The days off every session starts with in `ws-e2e`, far enough ahead to stay to come. */
export const HOLIDAYS: readonly Holiday[] = [
  {
    id: '0190f300-0000-7000-8000-000000000001',
    name: 'Tết Dương lịch',
    startsOn: '2030-01-01',
    endsOn: '2030-01-01',
  },
  {
    id: '0190f300-0000-7000-8000-000000000002',
    name: 'Tết Nguyên đán',
    startsOn: '2030-02-01',
    endsOn: '2030-02-07',
  },
];

const copies = new Map<string, Holiday[]>(); // session + workspace → its days off
let made = 0;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** The fields a body may hold, checked; null when one is wrong or another key is there. */
function fieldsOf(body: Record<string, unknown>): Partial<Omit<Holiday, 'id'>> | null {
  if (Object.keys(body).some((k) => !['name', 'startsOn', 'endsOn'].includes(k))) return null;
  const { name, startsOn, endsOn } = body;
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 100))
    return null;
  for (const d of [startsOn, endsOn])
    if (d !== undefined && (typeof d !== 'string' || !DATE.test(d))) return null;
  return {
    ...(typeof name === 'string' ? { name: name.trim() } : {}),
    ...(typeof startsOn === 'string' ? { startsOn } : {}),
    ...(typeof endsOn === 'string' ? { endsOn } : {}),
  };
}

/** Answers the routes of the days off and says true, or says false for any other route. `who` is null when signed out. */
export async function routeHolidays(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  who: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): Promise<boolean> {
  const m = /^\/v1\/workspaces\/([^/]+)\/holidays(?:\/([^/]+))?$/.exec(path);
  if (!m) return false;
  const [, wsId, hid] = m;
  if (!who) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (who.role !== 'owner' && who.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  if (!WORKSPACES.some((w) => w.id === wsId))
    return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const key = `${who.sid} ${wsId}`;
  const mine = copies.get(key) ?? (wsId === 'ws-e2e' ? HOLIDAYS.map((h) => ({ ...h })) : []);
  copies.set(key, mine);
  const listed = () => ({ data: [...mine].sort((a, b) => a.startsOn.localeCompare(b.startsOn)) });
  if (!hid && req.method === 'GET') return (edge.send(res, 200, listed()), true);
  const one = hid ? mine.find((h) => h.id === hid) : undefined;
  if (hid && !one) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  if (req.method === 'DELETE' && one) {
    if (one.endsOn < today())
      return (edge.problem(res, 422, 'holiday_in_past', 'trace-e2e-422'), true);
    mine.splice(mine.indexOf(one), 1);
    res.writeHead(204).end();
    return true;
  }
  const creating = !hid && req.method === 'POST';
  if (!creating && !(one && req.method === 'PATCH')) return false;
  const fields = fieldsOf(await edge.json(req));
  const next = { ...(one ?? { id: '', name: '', startsOn: '', endsOn: '' }), ...fields };
  const bad =
    !fields ||
    (creating && !req.headers['idempotency-key']) ||
    (creating && (!fields.name || !fields.startsOn || !fields.endsOn)) ||
    (!creating && Object.keys(fields).length === 0) ||
    next.startsOn > next.endsOn;
  if (bad) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  if (next.endsOn < today() || (one && one.endsOn < today()))
    return (edge.problem(res, 422, 'holiday_in_past', 'trace-e2e-422'), true);
  if (mine.some((h) => h !== one && h.startsOn <= next.endsOn && next.startsOn <= h.endsOn))
    return (edge.problem(res, 422, 'holiday_overlap', 'trace-e2e-422'), true);
  if (one) Object.assign(one, next);
  else mine.push({ ...next, id: `0190f300-0000-7000-8000-1${String(++made).padStart(11, '0')}` });
  return (edge.send(res, creating ? 201 : 200, one ?? mine[mine.length - 1]), true);
}
