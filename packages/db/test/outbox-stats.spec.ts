import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, outboxStats } from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// app.outbox_stats (N118, review E-01): totals over every organisation, for the monitoring. Other test files leave events behind in a
// database that is used again, so the test compares the numbers before and after its own events (A live, D deleted).
const [A, D] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;

const put = (org: string, status: string, created: string) =>
  admin.query(
    `INSERT INTO outbox_events (id, org_id, event_type, aggregate_type, aggregate_id, actor_kind, trace_id, status, attempts, created_at, claimed_at, published_at)
     VALUES ($1, $2, 'e.x', 'conversation', $3, 'system', 't', $4, CASE WHEN $4 = 'dead_letter' THEN 5 ELSE 0 END, now() + $5::interval,
             CASE WHEN $4 = 'claimed' THEN now() END, CASE WHEN $4 = 'published' THEN now() END)`,
    [uuidv7(), org, uuidv7(), status, created],
  );

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, D]) users.set(org, await seedTenant(admin, org));
  await admin.query('UPDATE organizations SET deleted_at = now() WHERE id = $1', [D]);
});
afterAll(async () => {
  await pool.end();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('app.outbox_stats', () => {
  it('is a SECURITY DEFINER function that returns three numbers, and only app_role may run it', async () => {
    const fn = await admin.query<{ definer: boolean; result: string; config: string[] }>(
      `SELECT prosecdef AS definer, pg_get_function_result(oid) AS result, proconfig AS config FROM pg_proc WHERE proname = 'outbox_stats'`,
    );
    expect(fn.rows).toEqual([
      {
        definer: true,
        result:
          'TABLE(pending bigint, oldest_pending_age_seconds double precision, dead_letter bigint)',
        config: ['search_path=pg_catalog, public, pg_temp'],
      },
    ]);
    const { rows } = await admin.query<{ r: string; ok: boolean }>(
      `SELECT r, has_function_privilege(r, 'app.outbox_stats()', 'EXECUTE') AS ok FROM unnest(ARRAY['app_role', 'auth_role', 'support_role', 'public']) AS r`,
    );
    expect(rows.filter((x) => x.ok).map((x) => x.r)).toEqual(['app_role']);
  });

  it('counts pending and dead-lettered events of live organisations without a tenant, and the age of the oldest pending one', async () => {
    const before = await outboxStats(pool);
    await put(A, 'pending', '-2 hours');
    await put(A, 'pending', '0');
    await put(A, 'dead_letter', '0');
    await put(A, 'published', '-3 hours');
    await put(A, 'claimed', '-3 hours');
    await put(D, 'pending', '-1 day');
    await put(D, 'dead_letter', '0');
    const after = await outboxStats(pool);
    expect(after.pending - before.pending).toBe(2);
    expect(after.deadLetter - before.deadLetter).toBe(1);
    // At least the two hours of A's event; not the day of D's, which is deleted (unless an older live event was left behind).
    expect(after.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(7200);
    if (before.pending === 0) expect(after.oldestPendingAgeSeconds).toBeLessThan(7300);
  });
});
