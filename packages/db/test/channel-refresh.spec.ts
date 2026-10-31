import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  channelRefreshDueOrgs,
  claimChannelRefresh,
  completeChannelRefresh,
  createDbPool,
  failChannelRefresh,
  withTenant,
  type TenantTx,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The claim and the write of the token refresh (zalo-channel spec §4, B2-1b, N173). Each organisation has the one Zalo OA account of seedTenant;
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
  refreshExpires?: string;
  claimed?: string | null;
  refresh?: boolean;
}
const set = (org: string, s: State = {}) =>
  admin.query(
    `UPDATE channel_accounts SET status = $2, access_token_expires_at = now() + $3::interval,
       refresh_claimed_at = now() + $4::interval, refresh_token_enc = CASE WHEN $5 THEN $6::bytea END,
       refresh_token_expires_at = now() + $7::interval, last_error = NULL
     WHERE org_id = $1`,
    [
      org,
      s.status ?? 'connected',
      s.expires === undefined ? '30 minutes' : s.expires,
      s.claimed ?? null,
      s.refresh ?? true,
      randomBytes(32),
      s.refreshExpires ?? '90 days',
    ],
  );
interface Row {
  status: string;
  last_error: string | null;
  refresh_claimed_at: Date | null;
  last_refreshed_at: Date | null;
}
const row = async (org: string) =>
  (
    await admin.query<Row>(
      'SELECT status, last_error, refresh_claimed_at, last_refreshed_at FROM channel_accounts WHERE org_id = $1',
      [org],
    )
  ).rows[0] as Row;
const as = <T>(org: string, fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(pool, { orgId: org, workspaceIds: [] }, fn);
const claim = (org: string) => as(org, (tx) => claimChannelRefresh(tx, 10, WINDOW));
const tokens = (keyVersion = 1) => ({
  keyVersion,
  accessTokenEnc: randomBytes(32),
  refreshTokenEnc: randomBytes(32),
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  refreshTokenExpiresAt: null,
});

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
    expect((await row(A)).refresh_claimed_at).toEqual(first!.claimedAt);
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

  it('never takes an account of another organisation, nor completes or fails one', async () => {
    await set(A, { expires: '2 hours' });
    await set(B);
    expect(await claim(A)).toEqual([]);
    const [theirs] = await claim(B);
    expect(theirs?.id).toBe(account.get(B));
    const key = { id: theirs!.id, claimedAt: theirs!.claimedAt };
    expect(await as(A, (tx) => completeChannelRefresh(tx, key, tokens()))).toBe(false);
    const failure = { errorCode: 'E_X', disconnect: true, warnSeconds: 0 };
    expect(await as(A, (tx) => failChannelRefresh(tx, key, failure))).toBeNull();
    expect(await row(B)).toMatchObject({ status: 'connected', last_error: null });
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

describe('completing and failing a claim', () => {
  it('writes the tokens and releases the claim; a stale claim or another key version writes nothing', async () => {
    await set(A, { status: 'token_expiring' });
    const [c] = await claim(A);
    const key = { id: c!.id, claimedAt: c!.claimedAt };
    const stale = { id: c!.id, claimedAt: new Date(c!.claimedAt.getTime() - 1) };
    expect(await as(A, (tx) => completeChannelRefresh(tx, stale, tokens()))).toBe(false);
    expect(await as(A, (tx) => completeChannelRefresh(tx, key, tokens(2)))).toBe(false);
    expect(await as(A, (tx) => completeChannelRefresh(tx, key, tokens()))).toBe(true);
    const after = await row(A);
    expect(after).toMatchObject({
      status: 'connected',
      last_error: null,
      refresh_claimed_at: null,
    });
    expect(after.last_refreshed_at).not.toBeNull();
  });

  it('keeps a failed account claimed (tried again after the lease), token_expiring once a token is near its end', async () => {
    const fail = async (s: State, failure: { disconnect: boolean; warnSeconds: number }) => {
      await set(A, s);
      const [c] = await claim(A);
      const status = await as(A, (tx) =>
        failChannelRefresh(tx, c!, { errorCode: 'E_TOKEN_NETWORK', ...failure }),
      );
      return [status, await row(A)] as const;
    };
    const [far, farRow] = await fail({}, { disconnect: false, warnSeconds: 60 });
    expect([far, farRow.last_error, farRow.refresh_claimed_at === null]).toEqual([
      'connected',
      'E_TOKEN_NETWORK',
      false,
    ]);
    expect(
      (await fail({ refreshExpires: '1 hour' }, { disconnect: false, warnSeconds: 86_400 }))[0],
    ).toBe('token_expiring');
    const [gone, goneRow] = await fail({}, { disconnect: true, warnSeconds: 0 });
    expect([gone, goneRow.refresh_claimed_at]).toEqual(['disconnected', null]);
    const bad = { errorCode: 'token abc', disconnect: true, warnSeconds: 0 };
    const key = { id: account.get(A)!, claimedAt: new Date() };
    await expect(as(A, (tx) => failChannelRefresh(tx, key, bad))).rejects.toBeInstanceOf(TypeError);
  });
});
