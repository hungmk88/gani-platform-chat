import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimOutboxBatch,
  createDbPool,
  failOutboxEvent,
  reapExpiredOutboxClaims,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Review E-02: a relay whose lease was taken back still holds the claim it had. When its publish then fails, its failOutboxEvent must
// not touch the claim of the relay that took the event after it (the inbound store already checks `attempts` for the same reason).
const ORG = uuidv7();
let user = '';
let admin: pg.Client;
let pool: pg.Pool;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: ORG, workspaceIds: [] }, fn);
const row = async (id: string) =>
  (
    await admin.query<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM outbox_events WHERE id = $1',
      [id],
    )
  ).rows[0];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  user = await seedTenant(admin, ORG);
});
afterAll(async () => {
  await pool.end();
  await cleanupTenant(admin, ORG, user);
  await admin.end();
});

describe('failOutboxEvent after the lease was taken back (review E-02)', () => {
  it('leaves the claim of the newer relay alone, and fails it only with the attempts of that claim', async () => {
    const id = uuidv7();
    await admin.query(
      `INSERT INTO outbox_events (id, org_id, event_type, aggregate_type, aggregate_id, actor_kind, trace_id) VALUES ($1, $2, 'e.x', 'conversation', $3, 'system', 't')`,
      [id, ORG, uuidv7()],
    );
    // The old relay claims (attempts 1), stalls past its lease; the reaper takes the event back, and the new relay claims it (attempts 2).
    const [old] = await inOrg((tx) => claimOutboxBatch(tx, 10));
    expect(old?.attempts).toBe(1);
    await admin.query(
      `UPDATE outbox_events SET claimed_at = now() - interval '5 minutes' WHERE id = $1`,
      [id],
    );
    expect(await inOrg((tx) => reapExpiredOutboxClaims(tx, 60, 5))).toBe(1);
    const [fresh] = await inOrg((tx) => claimOutboxBatch(tx, 10));
    expect(fresh?.attempts).toBe(2);

    const fail = (attempts: number) =>
      inOrg((tx) =>
        failOutboxEvent(tx, {
          id,
          attempts,
          errorCode: 'E_QUEUE',
          maxAttempts: 5,
          retryAfterSeconds: 30,
        }),
      );
    expect(await fail(1)).toBeNull();
    expect(await row(id)).toEqual({ status: 'claimed', attempts: 2 });
    expect(await fail(2)).toBe('pending');
    expect(await row(id)).toEqual({ status: 'pending', attempts: 2 });
  });
});
