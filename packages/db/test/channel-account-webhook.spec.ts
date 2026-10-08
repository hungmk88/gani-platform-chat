import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// app.channel_account_for_webhook (zalo-spec §3, N105): the webhook arrives with a channel account id and no tenant. A SECURITY DEFINER
// function (not a view) hands back the organisation, the public data and the two secrets as ciphertext, and never the tokens.
const [A, D] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
let [WA, WD] = ['', ''];
let admin: pg.Client;
let app: pg.Client;
let support: pg.Client;
let auth: pg.Client;

const CALL = 'SELECT * FROM app.channel_account_for_webhook($1)';
const secret = () =>
  Buffer.from(uuidv7().replaceAll('-', '') + uuidv7().replaceAll('-', ''), 'hex');
const addAccount = async (
  org: string,
  ws: string,
  over: { status?: string; deleted?: boolean } = {},
) => {
  const [id, appSecret, oaSecret, access, refresh] = [
    uuidv7(),
    secret(),
    secret(),
    secret(),
    secret(),
  ];
  await admin.query(
    `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, app_id, app_secret_enc, oa_secret_key_enc,
       access_token_enc, refresh_token_enc, key_version, status, deleted_at)
     VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA', 'app-1', $5, $6, $7, $8, 3, $9, CASE WHEN $10::boolean THEN now() END)`,
    [
      id,
      org,
      ws,
      `oa-${id}`,
      appSecret,
      oaSecret,
      access,
      refresh,
      over.status ?? 'connected',
      over.deleted ?? false,
    ],
  );
  return { id, appSecret, oaSecret };
};

beforeAll(async () => {
  [admin, app, support, auth] = [
    new pg.Client({ connectionString: url('migration') }),
    new pg.Client({ connectionString: url('app') }),
    new pg.Client({ connectionString: url('support') }),
    new pg.Client({ connectionString: url('auth') }),
  ];
  await Promise.all([admin.connect(), app.connect(), support.connect(), auth.connect()]);
  for (const org of [A, D]) users.set(org, await seedTenant(admin, org));
  const ws = async (org: string) =>
    (
      (await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [org]))
        .rows[0] as { id: string }
    ).id;
  [WA, WD] = [await ws(A), await ws(D)];
  await admin.query('UPDATE organizations SET deleted_at = now() WHERE id = $1', [D]);
});

afterAll(async () => {
  await Promise.all([app.end(), support.end(), auth.end()]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('what it returns', () => {
  it('is a STABLE SECURITY DEFINER function with a fixed search_path, not a view, and its result has no token and no id', async () => {
    const fn = await admin.query<{ definer: boolean; vol: string; result: string; cfg: string[] }>(
      `SELECT prosecdef AS definer, provolatile AS vol, pg_get_function_result(oid) AS result, proconfig AS cfg
       FROM pg_proc WHERE proname = 'channel_account_for_webhook'`,
    );
    expect(fn.rows).toEqual([
      {
        definer: true,
        vol: 's',
        result:
          'TABLE(org_id uuid, workspace_id uuid, type text, status text, key_version integer, app_id text, app_secret_enc bytea, oa_secret_key_enc bytea)',
        cfg: ['search_path=pg_catalog, public, pg_temp'],
      },
    ]);
    expect(
      (await admin.query("SELECT 1 FROM pg_views WHERE viewname = 'channel_account_for_webhook'"))
        .rowCount,
    ).toBe(0);
  });

  it('gives the organisation, the workspace, the public data and the two secrets, byte for byte', async () => {
    const account = await addAccount(A, WA);
    const { rows } = await app.query<Record<string, unknown>>(CALL, [account.id]);
    const row = rows[0] as Record<string, unknown>;
    expect(rows).toHaveLength(1);
    expect(row).toMatchObject({
      org_id: A,
      workspace_id: WA,
      type: 'zalo_oa',
      status: 'connected',
      key_version: 3,
      app_id: 'app-1',
    });
    expect(Buffer.compare(row['app_secret_enc'] as Buffer, account.appSecret)).toBe(0);
    expect(Buffer.compare(row['oa_secret_key_enc'] as Buffer, account.oaSecret)).toBe(0);
    expect(Object.keys(row)).not.toContain('access_token_enc');
    expect(Object.keys(row)).not.toContain('refresh_token_enc');
  });

  it('still gives a disconnected account, with its status, so the API can decide', async () => {
    const account = await addAccount(A, WA, { status: 'disconnected' });
    expect((await app.query(CALL, [account.id])).rows).toMatchObject([{ status: 'disconnected' }]);
  });
});

describe('what it does not return', () => {
  it('nothing for a deleted account, an account of a deleted organisation, an unknown id or a null id', async () => {
    const [deleted, ofDeletedOrg] = [
      await addAccount(A, WA, { deleted: true }),
      await addAccount(D, WD),
    ];
    for (const id of [deleted.id, ofDeletedOrg.id, uuidv7(), null]) {
      expect((await app.query(CALL, [id])).rows, String(id)).toEqual([]);
    }
  });
});

describe('who may run it', () => {
  it('app_role runs it without a tenant context, while reading the table directly still raises TN001', async () => {
    const account = await addAccount(A, WA);
    expect((await app.query(CALL, [account.id])).rowCount).toBe(1);
    expect(await sqlState(app.query('SELECT * FROM channel_accounts'))).toBe('TN001');
  });

  it('is executable by app_role only (not support_role, not auth_role, not PUBLIC)', async () => {
    const { rows } = await admin.query<{ r: string; ok: boolean }>(
      `SELECT r, has_function_privilege(r, 'app.channel_account_for_webhook(uuid)', 'EXECUTE') AS ok
       FROM unnest(ARRAY['app_role', 'auth_role', 'support_role', 'public']) AS r`,
    );
    expect(rows.filter((x) => x.ok).map((x) => x.r)).toEqual(['app_role']);
    expect(await sqlState(support.query(CALL, [uuidv7()]))).toBe('42501');
    expect(await sqlState(auth.query(CALL, [uuidv7()]))).toBe('42501');
  });
});
