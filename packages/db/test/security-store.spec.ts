import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  changeSecurityIncident,
  createDbPool,
  InvalidIncidentAlertError,
  InvalidIncidentHandlerError,
  listSecurityAlerts,
  listSecurityIncidents,
  openSecurityIncident,
  SecurityIncidentClosedError,
  withTenant,
  type TenantTx,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The security store (P11a-2, N207) against PostgreSQL as app_role. Org A: its owner (seedTenant), an admin, a manager and a suspended
// admin; four alerts. Org B: one alert, never seen from A.
const [A, B] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
const [ADMIN, MANAGER, SUSPENDED] = [uuidv7(), uuidv7(), uuidv7()];
const alertsA: string[] = [];
let alertB = '';
let owner = '';
let admin: pg.Client;
let pool: pg.Pool;

const inA = <T>(fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(pool, { orgId: A, workspaceIds: [] }, fn);
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof Error ? e.name : 'other'),
  );
async function member(org: string, id: string, role: string, status = 'active') {
  await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
    id,
    `${id}@example.test`,
  ]);
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv7(), org, id, role, status],
  );
}
async function alert(org: string, severity: string, minute: number): Promise<string> {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO security_alerts (id, org_id, kind, severity, subject_user_id, window_start)
     VALUES ($1, $2, 'login_failures', $3, $4, '2026-11-08T08:00:00Z'::timestamptz + make_interval(mins => $5))`,
    [id, org, severity, users.get(org), minute],
  );
  return id;
}
const open = (alertIds: string[], handlerUserId = ADMIN, title = ' Đăng nhập lạ ') =>
  inA((tx) =>
    openSecurityIncident(tx, {
      id: uuidv7(),
      title,
      severity: 'high',
      handlerUserId,
      openedBy: { userId: owner },
      alertIds,
    }),
  );

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  owner = users.get(A)!;
  await member(A, ADMIN, 'admin');
  await member(A, MANAGER, 'manager');
  await member(A, SUSPENDED, 'admin', 'suspended');
  for (const [severity, minute] of [
    ['low', 0],
    ['high', 15],
    ['high', 30],
    ['critical', 45],
  ] as const)
    alertsA.push(await alert(A, severity, minute));
  alertB = await alert(B, 'high', 0);
});

afterAll(async () => {
  await admin.query('DELETE FROM security_alerts WHERE org_id = ANY($1::uuid[])', [[A, B]]);
  await admin.query('DELETE FROM security_incidents WHERE org_id = ANY($1::uuid[])', [[A, B]]);
  await admin.query('DELETE FROM org_members WHERE user_id = ANY($1::uuid[])', [
    [ADMIN, MANAGER, SUSPENDED],
  ]);
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ADMIN, MANAGER, SUSPENDED]]);
  await pool.end();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('the alerts of an organisation', () => {
  it('lists its own, newest first, a page at a time, by severity; never those of another organisation', async () => {
    const first = await inA((tx) => listSecurityAlerts(tx, { limit: 3 }));
    expect(first.rows.map((r) => r.id)).toEqual([...alertsA].reverse().slice(0, 3));
    // seedTenant also wrote one alert (covered by its incident), older than these four: the last of the second page.
    const second = await inA((tx) =>
      listSecurityAlerts(tx, { limit: 3, cursor: first.nextCursor! }),
    );
    expect(second.rows).toHaveLength(2);
    expect(second.rows[0]).toMatchObject({ id: alertsA[0], count: 1, incidentId: null });
    expect(second.nextCursor).toBeNull();
    const high = await inA((tx) => listSecurityAlerts(tx, { severity: 'high', limit: 10 }));
    expect(high.rows.map((r) => r.id)).toEqual([alertsA[2], alertsA[1]]);
    expect(high.rows.map((r) => r.id)).not.toContain(alertB);
  });
});

describe('opening an incident', () => {
  it('covers its alerts and lists them; open=true then leaves them out', async () => {
    const made = await open([alertsA[1]!, alertsA[2]!]);
    expect(made).toMatchObject({
      title: 'Đăng nhập lạ',
      severity: 'high',
      status: 'open',
      handlerUserId: ADMIN,
      openedByUserId: owner,
      openedByOperatorId: null,
      closedAt: null,
      alertIds: [alertsA[1], alertsA[2]],
    });
    const free = await inA((tx) => listSecurityAlerts(tx, { open: true, limit: 10 }));
    expect(free.rows.map((r) => r.id)).toEqual([alertsA[3], alertsA[0]]);
    const covered = await inA((tx) => listSecurityAlerts(tx, { open: false, limit: 10 }));
    expect(covered.rows.filter((r) => r.incidentId === made.id).map((r) => r.id)).toEqual([
      alertsA[2],
      alertsA[1],
    ]);
  });

  it('refuses an alert another incident covers, or of another organisation, and then writes nothing', async () => {
    const before = (await inA((tx) => listSecurityIncidents(tx, { limit: 100 }))).rows.length;
    expect(await refusal(open([alertsA[0]!, alertsA[1]!]))).toBe(InvalidIncidentAlertError.name);
    expect(await refusal(open([alertB]))).toBe(InvalidIncidentAlertError.name);
    expect((await inA((tx) => listSecurityIncidents(tx, { limit: 100 }))).rows).toHaveLength(
      before,
    );
    const a0 = await inA((tx) => listSecurityAlerts(tx, { open: true, limit: 10 }));
    expect(a0.rows.map((r) => r.id)).toContain(alertsA[0]);
  });

  it('takes an active Owner or Admin as handler; not a manager, a suspended admin or someone of another organisation', async () => {
    expect(await refusal(open([], owner))).toBe('ok');
    for (const handler of [MANAGER, SUSPENDED, users.get(B)!])
      expect(await refusal(open([], handler))).toBe(InvalidIncidentHandlerError.name);
  });

  it('may be opened by a platform operator, who is not a member', async () => {
    const operator = uuidv7();
    await admin.query(
      `INSERT INTO users (id, email, status, is_platform_operator) VALUES ($1, $2, 'active', true)`,
      [operator, `${operator}@example.test`],
    );
    const made = await inA((tx) =>
      openSecurityIncident(tx, {
        id: uuidv7(),
        title: 'Truy cập hỗ trợ',
        severity: 'low',
        handlerUserId: owner,
        openedBy: { operatorId: operator },
        alertIds: [],
      }),
    );
    expect(made).toMatchObject({
      openedByUserId: null,
      openedByOperatorId: operator,
      alertIds: [],
    });
    await admin.query('DELETE FROM security_incidents WHERE id = $1', [made.id]);
    await admin.query('DELETE FROM users WHERE id = $1', [operator]);
  });
});

describe('changing an incident', () => {
  it('hands it to another Owner or Admin, then closes it once; a closed one stays closed', async () => {
    const made = await open([]);
    const handed = await inA((tx) => changeSecurityIncident(tx, made.id, { handlerUserId: owner }));
    expect(handed).toMatchObject({ handlerUserId: owner, status: 'open', closedAt: null });
    expect(
      await refusal(inA((tx) => changeSecurityIncident(tx, made.id, { handlerUserId: MANAGER }))),
    ).toBe(InvalidIncidentHandlerError.name);
    const closed = await inA((tx) => changeSecurityIncident(tx, made.id, { close: true }));
    expect(closed).toMatchObject({ status: 'closed', closedAt: expect.any(Date) as Date });
    for (const change of [{ close: true as const }, { handlerUserId: ADMIN }])
      expect(await refusal(inA((tx) => changeSecurityIncident(tx, made.id, change)))).toBe(
        SecurityIncidentClosedError.name,
      );
    const closedOnes = await inA((tx) =>
      listSecurityIncidents(tx, { status: 'closed', limit: 100 }),
    );
    expect(closedOnes.rows.map((r) => r.id)).toEqual([made.id]);
  });

  it('finds no incident of another organisation, nor an unknown one', async () => {
    const made = await open([]);
    expect(
      await withTenant(pool, { orgId: B, workspaceIds: [] }, (tx) =>
        changeSecurityIncident(tx, made.id, { close: true }),
      ),
    ).toBeNull();
    expect(await inA((tx) => changeSecurityIncident(tx, uuidv7(), { close: true }))).toBeNull();
  });
});
