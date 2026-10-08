import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimInboundBatch,
  createDbPool,
  failInboundEvent,
  markInboundProcessed,
  pendingInboundOrgs,
  purgeInboundEventKeys,
  reapExpiredInboundClaims,
  requeueInboundDeadLetters,
  withTenant,
  type InboundEventKey,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The second part of the inbound store (N106): a failure, a lease that ran out, a dead letter put back, the organisations with work,
// and the old keys. A and B have events of their own. Times are offsets from now(); rows are made with now(), so received_at has
// microseconds, as in production.
const [A, B] = [uuidv7(), uuidv7()];
const orgs = [A, B];
const users = new Map<string, string>();
const where = new Map<string, { workspace: string; channel: string }>();
let admin: pg.Client;
let pool: pg.Pool;

const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: A, workspaceIds: [] }, fn);

interface Row {
  org?: string;
  status?: string;
  attempts?: number;
  /** available_at / claimed_at, as offsets from now(). */
  due?: string;
  claimed?: string;
  lastError?: string | null;
}
// prettier-ignore
const put = async (o: Row = {}) => {
  const place = where.get(o.org ?? A) as { workspace: string; channel: string };
  const id = uuidv7();
  await admin.query(
    `INSERT INTO inbound_events (id, org_id, workspace_id, channel_account_id, platform_message_id, event_type, payload, status, attempts, available_at, claimed_at, processed_at, last_error)
     VALUES ($1, $2, $3, $4, $5, 't', '{}', $6, $7, now() + $8::interval, CASE WHEN $6 = 'claimed' THEN now() + $9::interval END,
       CASE WHEN $6 IN ('processed', 'ignored') THEN now() END, CASE WHEN $6 IN ('ignored', 'dead_letter') THEN coalesce($10, 'E_X') ELSE $10 END)`,
    [id, o.org ?? A, place.workspace, place.channel, `m-${id}`, o.status ?? 'pending', o.attempts ?? 0, o.due ?? '-1 minute', o.claimed ?? '0', o.lastError ?? null],
  );
  return id;
};
const clear = async () => {
  await admin.query('DELETE FROM inbound_events WHERE org_id = ANY($1::uuid[])', [orgs]);
  await admin.query('DELETE FROM inbound_event_keys WHERE org_id = ANY($1::uuid[])', [orgs]);
};
const row = async (id: string) =>
  (
    await admin.query<{
      status: string;
      attempts: number;
      last_error: string | null;
      claimed: boolean;
      wait: number;
    }>(
      `SELECT status, attempts, last_error, claimed_at IS NOT NULL AS claimed, extract(epoch FROM available_at - now())::float AS wait
       FROM inbound_events WHERE id = $1`,
      [id],
    )
  ).rows[0];
const keyOf = async (id: string): Promise<InboundEventKey> => {
  const { rows } = await admin.query<{ received_at: Date }>(
    'SELECT received_at FROM inbound_events WHERE id = $1',
    [id],
  );
  return { id, receivedAt: rows[0]?.received_at as Date };
};
const fail = async (
  id: string,
  attempts: number,
  over: Partial<Parameters<typeof failInboundEvent>[1]> = {},
) =>
  inA(async (tx) =>
    failInboundEvent(tx, {
      ...(await keyOf(id)),
      attempts,
      errorCode: 'E_PROCESS',
      maxAttempts: 5,
      retryAfterSeconds: 60,
      ...over,
    }),
  );
const claimOne = async () => (await inA((tx) => claimInboundBatch(tx, { limit: 1 })))[0];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 4 });
  for (const org of orgs) {
    users.set(org, await seedTenant(admin, org));
    const { rows } = await admin.query<{ workspace: string; channel: string }>(
      'SELECT workspace_id AS workspace, id AS channel FROM channel_accounts WHERE org_id = $1',
      [org],
    );
    where.set(org, rows[0] as { workspace: string; channel: string });
  }
});

afterAll(async () => {
  await pool.end();
  await clear();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('failInboundEvent', () => {
  it('puts a first failure back to pending after the delay, with the code, and does not raise attempts', async () => {
    await clear();
    const id = await put();
    const claimed = await claimOne();
    expect(await fail(id, claimed?.attempts as number)).toBe('pending');
    const r = await row(id);
    expect(r).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error: 'E_PROCESS',
      claimed: false,
    });
    expect(r?.wait).toBeGreaterThan(55);
    expect(r?.wait).toBeLessThan(65);
  });

  it('makes it a dead letter once attempts reached the maximum, and keeps the code', async () => {
    await clear();
    const id = await put({ status: 'claimed', attempts: 5 });
    expect(await fail(id, 5)).toBe('dead_letter');
    expect(await row(id)).toMatchObject({
      status: 'dead_letter',
      last_error: 'E_PROCESS',
      claimed: false,
    });
  });

  it('says null when the event is no longer claimed, and leaves it as it is', async () => {
    await clear();
    for (const status of ['pending', 'processed']) {
      const id = await put({ status, attempts: 1 });
      expect(await fail(id, 1)).toBeNull();
      expect((await row(id))?.status).toBe(status);
    }
  });

  it('does not touch the claim of another worker: a failure of the old claim says null (the old generation)', async () => {
    await clear();
    const id = await put();
    const first = await claimOne(); // worker A: attempts 1
    await admin.query(
      "UPDATE inbound_events SET claimed_at = now() - interval '5 minutes' WHERE id = $1",
      [id],
    );
    expect(await inA((tx) => reapExpiredInboundClaims(tx, 60, 5))).toBe(1);
    const second = await claimOne(); // worker B: attempts 2
    expect([first?.attempts, second?.attempts]).toEqual([1, 2]);
    expect(await fail(id, first?.attempts as number)).toBeNull();
    expect(await row(id)).toMatchObject({ status: 'claimed', attempts: 2, claimed: true });
  });

  it.each([
    ['attempts 0', { attempts: 0 }],
    ['maxAttempts 0', { maxAttempts: 0 }],
    ['retryAfterSeconds -1', { retryAfterSeconds: -1 }],
    ['retryAfterSeconds 1.5', { retryAfterSeconds: 1.5 }],
  ])('refuses %s (RangeError) before it reaches the database', async (_name, over) => {
    await clear();
    const id = await put({ status: 'claimed', attempts: 1 });
    await expect(fail(id, 1, over)).rejects.toThrow(RangeError);
    expect((await row(id))?.status).toBe('claimed');
  });

  it.each(['e_lower', 'Nguyen Van A', '090 123 4567', '', `E_${'X'.repeat(70)}`])(
    'refuses %j as a code, does not repeat it in the error, and leaves the row claimed',
    async (errorCode) => {
      await clear();
      const id = await put({ status: 'claimed', attempts: 1 });
      const error = await fail(id, 1, { errorCode }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TypeError);
      if (errorCode.trim()) expect((error as Error).message).not.toContain(errorCode.trim());
      expect((await row(id))?.status).toBe('claimed');
    },
  );
});

describe('reapExpiredInboundClaims', () => {
  it('takes back only what is past its lease, of its own organisation, without raising attempts', async () => {
    await clear();
    const expired = await put({
      status: 'claimed',
      attempts: 2,
      claimed: '-5 minutes',
      lastError: 'E_PREV',
    });
    const held = await put({ status: 'claimed', attempts: 1, claimed: '-5 seconds' });
    const pending = await put({ attempts: 1 });
    const processed = await put({ status: 'processed' });
    const theirs = await put({ org: B, status: 'claimed', claimed: '-5 minutes' });
    expect(await inA((tx) => reapExpiredInboundClaims(tx, 60, 5))).toBe(1);
    expect(await row(expired)).toMatchObject({
      status: 'pending',
      attempts: 2,
      last_error: 'E_PREV',
      claimed: false,
    });
    expect((await row(held))?.status).toBe('claimed');
    expect([(await row(pending))?.status, (await row(processed))?.status]).toEqual([
      'pending',
      'processed',
    ]);
    expect((await row(theirs))?.status).toBe('claimed');
  });

  it('makes it a dead letter with E_LEASE_EXPIRED once attempts reached the maximum', async () => {
    await clear();
    const id = await put({ status: 'claimed', attempts: 5, claimed: '-5 minutes' });
    expect(await inA((tx) => reapExpiredInboundClaims(tx, 60, 5))).toBe(1);
    expect(await row(id)).toMatchObject({
      status: 'dead_letter',
      attempts: 5,
      last_error: 'E_LEASE_EXPIRED',
      claimed: false,
    });
  });

  it.each([
    [0, 5],
    [60, 0],
    [1.5, 5],
  ])('refuses lease %s with maximum %s (RangeError)', async (lease, max) => {
    await expect(inA((tx) => reapExpiredInboundClaims(tx, lease, max))).rejects.toThrow(RangeError);
  });
});

describe('requeueInboundDeadLetters', () => {
  it('puts the dead letters of the organisation back to pending, fresh, and touches nothing else', async () => {
    await clear();
    const dead = [
      await put({ status: 'dead_letter', attempts: 5 }),
      await put({ status: 'dead_letter', attempts: 5, lastError: 'E_Y' }),
    ];
    const pending = await put({ attempts: 1 });
    const theirs = await put({ org: B, status: 'dead_letter', attempts: 5 });
    expect(await inA((tx) => requeueInboundDeadLetters(tx))).toBe(2);
    for (const id of dead) {
      const r = await row(id);
      expect(r).toMatchObject({ status: 'pending', attempts: 0, last_error: null, claimed: false });
      expect(Math.abs(r?.wait as number)).toBeLessThan(5);
    }
    expect((await row(pending))?.attempts).toBe(1);
    expect((await row(theirs))?.status).toBe('dead_letter');
  });

  it('puts back only the keys it is given, and nothing for an empty list', async () => {
    await clear();
    const [one, two] = [
      await put({ status: 'dead_letter', attempts: 5 }),
      await put({ status: 'dead_letter', attempts: 5 }),
    ];
    expect(await inA(async (tx) => requeueInboundDeadLetters(tx, []))).toBe(0);
    expect([(await row(one))?.status, (await row(two))?.status]).toEqual([
      'dead_letter',
      'dead_letter',
    ]);
    expect(await inA(async (tx) => requeueInboundDeadLetters(tx, [await keyOf(one)]))).toBe(1);
    expect([(await row(one))?.status, (await row(two))?.status]).toEqual([
      'pending',
      'dead_letter',
    ]);
  });
});

describe('the life of an event', () => {
  it('is claimed and fails five times, becomes a dead letter at the fifth, and after a requeue is claimed again from one', async () => {
    await clear();
    const id = await put();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claimed = await claimOne();
      expect([claimed?.id, claimed?.attempts]).toEqual([id, attempt]);
      const outcome = await fail(id, attempt, { retryAfterSeconds: 0 });
      expect(outcome).toBe(attempt < 5 ? 'pending' : 'dead_letter');
    }
    expect(await claimOne()).toBeUndefined();
    expect(await inA((tx) => requeueInboundDeadLetters(tx))).toBe(1);
    const again = await claimOne();
    expect([again?.id, again?.attempts]).toEqual([id, 1]);
    expect(await inA(async (tx) => markInboundProcessed(tx, await keyOf(id)))).toBe(true);
  });
});

describe('the functions called through the pool', () => {
  it('pendingInboundOrgs names an organisation with an event due, not one that only waits for its backoff', async () => {
    await clear();
    await put();
    await put({ org: B, due: '10 minutes' });
    expect((await pendingInboundOrgs(pool, 1000, 60)).filter((o) => orgs.includes(o))).toEqual([A]);
    expect(await sqlState(pendingInboundOrgs(pool, 0, 60))).toBe('22023');
  });

  it('purgeInboundEventKeys removes the keys past their time and keeps the others; the database refuses less than 30 days', async () => {
    await clear();
    const { channel } = where.get(A) as { channel: string };
    const key = (id: string, days: number) =>
      admin.query(
        `INSERT INTO inbound_event_keys (org_id, channel_account_id, platform_message_id, created_at) VALUES ($1, $2, $3, now() - make_interval(days => $4))`,
        [A, channel, id, days],
      );
    await key('old', 36);
    await key('recent', 1);
    expect(await purgeInboundEventKeys(pool, 35, 1000)).toBeGreaterThanOrEqual(1);
    const left = await admin.query<{ platform_message_id: string }>(
      'SELECT platform_message_id FROM inbound_event_keys WHERE org_id = $1',
      [A],
    );
    expect(left.rows.map((r) => r.platform_message_id)).toEqual(['recent']);
    expect(await sqlState(purgeInboundEventKeys(pool, 29, 10))).toBe('22023');
  });
});
