import { randomBytes } from 'node:crypto';

import { ConversationStateMachine } from '@gani/conversations';
import { withTenant } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { hash } from '@node-rs/argon2';
import { io, type Socket } from 'socket.io-client';
import { describe, expect, it } from 'vitest';

import { API_ORIGIN, spawnApi, type ApiProcess } from './api.js';
import { spawnWorker, waitFor, workerEnv } from './harness.js';
import { useQueueSuite } from './suite.js';

// conversation.sla_changed through the whole slice (E4a, E4b; CEO 08/11/2026): FSM or SLA job → outbox → relay → queue → consumer →
// realtime emitter on Valkey → the redis adapter of the API → the socket of an agent of the workspace. Three cases, each on its own
// stack: the agent waits for the customer (T09), the customer answers while no agent is online (T11, E3-1; T10 needs presence, S4),
// and the workspace closes (the SLA job, `outside_hours`). The workspace is open all day, so only the day off of case 3 closes it.
const suite = useQueueSuite();
const fsm = new ConversationStateMachine();
type Sla = { dueAt: string; pausedReason: string | null } | null;

async function stack() {
  const { admin, app } = suite;
  const [org, ws, user, PW] = [
    await suite.newOrg(),
    uuidv7(),
    uuidv7(),
    randomBytes(18).toString('base64url'),
  ];
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`,
    [ws, org, `w-${ws}`],
  );
  for (let weekday = 1; weekday <= 7; weekday++)
    await admin.query(
      `INSERT INTO workspace_hours (id, org_id, workspace_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4, '00:00', '24:00')`,
      [uuidv7(), org, ws, weekday],
    );
  await admin.query(
    `INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`,
    [user, `${user}@example.test`],
  );
  await admin.query(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $2, 'credential', $3)`,
    [uuidv7(), user, await hash(PW)],
  );
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'manager', 'active')`,
    [uuidv7(), org, user],
  );
  await admin.query(
    `INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)`,
    [uuidv7(), org, ws, user],
  );
  const api: ApiProcess = await spawnApi(randomBytes(32).toString('hex'));
  spawnWorker(
    'dist/main.js',
    workerEnv({
      EVENTS_CONSUMER_ENABLED: '1',
      EVENTS_DISCOVERY_MS: '200',
      EVENTS_MAX_QUEUES: '10000',
      SLA_HOURS_POLL_MS: '500',
    }),
  );
  const res = await fetch(`${api.url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: API_ORIGIN,
      'x-forwarded-for': [...randomBytes(4)].join('.'),
    },
    body: JSON.stringify({ email: `${user}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const socket: Socket = io(`${api.url}/agent`, {
    transports: ['websocket'],
    extraHeaders: { origin: API_ORIGIN, cookie },
    reconnection: false,
    forceNew: true,
  });
  const slas: Sla[] = [];
  socket.on('conversation.sla_changed', (p: { data: { sla: Sla } }) => slas.push(p.data.sla));
  await new Promise<void>(
    (done, fail) => (socket.once('connect', done), socket.once('connect_error', fail)),
  );
  const tenant = { orgId: org, workspaceIds: [ws] };
  // A conversation the bot hands to the queue (T02): the first SLA, 60 working minutes.
  const id = await withTenant(app, tenant, async (tx) => {
    const created = await fsm.create(tx, {
      workspaceId: ws,
      actor: { kind: 'system' },
      traceId: 'e2e',
    });
    const cid = created.kind === 'changed' ? created.conversation.id : '';
    await fsm.transition(
      tx,
      cid,
      { type: 'needs_human', inHours: true },
      { actor: { kind: 'bot' }, traceId: 'e2e' },
    );
    return cid;
  });
  const post = (path: string, body: object = {}) =>
    fetch(`${api.url}/v1/conversations/${id}/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: API_ORIGIN,
        cookie,
        'idempotency-key': uuidv7(),
      },
      body: JSON.stringify(body),
    });
  const next = (count: number, label: string) =>
    waitFor(() => Promise.resolve(slas.length >= count && slas), {
      timeoutMs: 45_000,
      label: `${label}\n--- API ---\n${api.tail()}`,
    });
  const done = async () => {
    socket.disconnect();
    await api.stop();
    for (const table of ['sessions', 'workspace_members', 'org_members', 'accounts'])
      await admin.query(`DELETE FROM ${table} WHERE user_id = $1`, [user]).catch(() => undefined);
    await admin.query('DELETE FROM users WHERE id = $1', [user]).catch(() => undefined);
  };
  await next(1, 'the SLA of the handover (T02)');
  expect(slas[0]).toMatchObject({ pausedReason: null });
  return { org, ws, id, tenant, slas, post, next, done };
}

describe('conversation.sla_changed to the socket', () => {
  it('pauses the SLA for the customer when the agent waits for them (T09)', async () => {
    const s = await stack();
    try {
      expect((await s.post('claim')).status).toBe(200); // T05 keeps the SLA: no packet
      expect((await s.post('wait-customer', { version: 2 })).status).toBe(200);
      const got = await s.next(2, 'the pause of T09');
      expect(got).toEqual([got[0], { dueAt: got[0]?.dueAt, pausedReason: 'waiting_customer' }]);
    } finally {
      await s.done();
    }
  }, 180_000);

  it('starts the SLA again from 0 when the customer answers and no agent is online (T11)', async () => {
    const s = await stack();
    try {
      expect((await s.post('claim')).status).toBe(200);
      expect((await s.post('wait-customer', { version: 2 })).status).toBe(200);
      await s.next(2, 'the pause of T09');
      await withTenant(suite.app, s.tenant, (tx) =>
        fsm.onCustomerMessage(tx, s.id, { now: new Date(), agentOnline: false, traceId: 'e2e' }),
      );
      const got = await s.next(3, 'the new SLA of T11');
      expect(got[2]).toMatchObject({ pausedReason: null });
      expect(Date.parse(got[2]?.dueAt ?? '')).toBeGreaterThan(Date.parse(got[0]?.dueAt ?? ''));
    } finally {
      await s.done();
    }
  }, 180_000);

  it('pauses it outside the hours when the workspace closes: a day off from today (the SLA job)', async () => {
    const s = await stack();
    try {
      await suite.admin.query(
        `INSERT INTO workspace_holidays (id, org_id, workspace_id, name, starts_on, ends_on)
         VALUES ($1, $2, $3, 'E2E', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 1)`,
        [uuidv7(), s.org, s.ws],
      );
      const got = await s.next(2, 'the pause of the SLA job');
      expect(got[1]).toEqual({ dueAt: got[0]?.dueAt, pausedReason: 'outside_hours' });
    } finally {
      await s.done();
    }
  }, 180_000);
});
