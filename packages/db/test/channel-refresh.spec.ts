import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  channelRefreshDueOrgs,
  claimChannelRefresh,
  createDbPool,
  withTenant,
  type TenantTx,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The claim of the token refresh (zalo-channel spec §4, B2-1b, N173). Each organisation has the one Zalo OA account of seedTenant;
// `set` puts it in the state a case needs, times as offsets from now() so nothing sleeps.
const [A, B] = [uuidv7(), uuidv7()];
const orgs = [A, B];
const users = new Map<string, string>();
const account = new Map<string, string>();
const WINDOW = { beforeSeconds: 3600, leaseSeconds: 60 };
let admin: pg.Client;
let pool: pg.Pool;

interface State {
  status?: string;
  expires?: string | null;
  claimed?: string | null;
  refresh?: boolean;
}
const set = (org: string, s: State = {}) =>
  admin.query(
    `UPDATE channel_accounts SET status = $2, access_token_expires_at = now() + $3::interval,
       refresh_claimed_at = now() + $4::interval, refresh_token_enc = CASE WHEN $5 THEN $6::bytea END
     WHERE org_id = $1`,
    [
      org,
      s.status ?? 'connected',
      s.expires === undefined ? '30 minutes' : s.expires,
      s.claimed ?? null,
      s.refresh ?? true,
      randomBytes(32),
    ],
  );
const claimedAt = async (org: string) =>
  (
    await admin.query<{ at: Date | null }>(
      'SELECT refresh_claimed_at AS at FROM channel_accounts WHERE org_id = $1',
      [org],
    )
  ).rows[0]?.at;
const as = <T>(org: string, fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(pool, { orgId: org, workspaceIds: [] }, fn);
const claim = (org: string) => as(org, (tx) => claimChannelRefresh(tx, 10, WINDOW));

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 3 });
  for (const org of orgs) {
    users.set(org, await seedTenant(admin, org));
    const { rows } = await admin.query<{ id: string }>(
      'SELECT id FROM channel_accounts WHERE org_id = $1',
      [org],
    );
    account.set(org, rows[0]!.id);
  }
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('claimChannelRefresh', () => {
  it('stamps the account, then keeps it off every claim until the lease runs out', async () => {
    await set(A);
    const [first] = await claim(A);
    expect(first).toMatchObject({ id: account.get(A), status: 'connected', keyVersion: 1 });
    expect(await claimedAt(A)).toEqual(first!.claimedAt);
    expect(await claim(A)).toEqual([]);
    await set(A, { claimed: '-5 minutes' });
    expect((await claim(A)).map((c) => c.id)).toEqual([account.get(A)]);
    await expect(as(A, (tx) => claimChannelRefresh(tx, 0, WINDOW))).rejects.toBeInstanceOf(
      RangeError,
    );
  });

  it('gives the account to one of two jobs at once; the other gets nothing and does not wait (SKIP LOCKED)', async () => {
    await set(A);
    let held!: () => void;
    let release!: () => void;
    const holding = new Promise<void>((r) => (held = r));
    const first = as(A, async (tx) => {
      const got = await claimChannelRefresh(tx, 10, WINDOW);
      held();
      await new Promise<void>((r) => (release = r));
      return got;
    });
    await holding;
    const second = await as(A, async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
      return claimChannelRefresh(tx, 10, WINDOW);
    }).finally(() => release());
    expect([(await first).length, second.length]).toEqual([1, 0]);
  });

  it('never takes an account of another organisation', async () => {
    await set(A, { expires: '2 hours' });
    await set(B);
    expect(await claim(A)).toEqual([]);
    expect((await claim(B)).map((c) => c.id)).toEqual([account.get(B)]);
  });
});

describe('app.channel_refresh_due_orgs and claimChannelRefresh', () => {
  it('agree on what is due: the claim takes the account exactly when the function names its organisation', async () => {
    const states: State[] = [
      {},
      { expires: '2 hours' },
      { status: 'disconnected' },
      { refresh: false },
      { expires: null },
      { claimed: '-5 seconds' },
      { status: 'token_expiring', claimed: '-5 minutes' },
    ];
    const seen: boolean[] = [];
    for (const s of states) {
      await set(A, s);
      // 1000: the most the function gives, so organisations other specs left cannot push A out of the list.
      const named = (await channelRefreshDueOrgs(pool, 1000, WINDOW)).includes(A);
      expect((await claim(A)).length === 1, JSON.stringify(s)).toBe(named);
      seen.push(named);
    }
    expect(seen).toEqual([true, false, false, false, false, false, true]);
  });
});
