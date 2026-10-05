import { uuidv7 } from '@gani/domain';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  TenantContextMissingError,
  createDbPool,
  currentTenantContext,
  withAuthUser,
} from '../src/index.js';
import { sqlState, url } from './db.js';

// PR6b (spec RLS M01 §3.7, N77): app.auth_user_id() and withAuthUser. An empty value is normal (NULL), a wrong one is an error.
let admin: pg.Client;
let auth: pg.Client;
let app: pg.Client;
let support: pg.Client;
let pool: pg.Pool;

const inTx = async <T>(setting: string | null, fn: () => Promise<T>): Promise<T> => {
  await auth.query('BEGIN');
  try {
    if (setting !== null)
      await auth.query("SELECT set_config('app.auth_user_id', $1, true)", [setting]);
    return await fn();
  } finally {
    await auth.query('ROLLBACK').catch(() => undefined);
  }
};
const current = async () =>
  (await auth.query<{ id: string | null }>('SELECT app.auth_user_id() AS id')).rows[0]?.id;

beforeAll(async () => {
  [admin, auth, app, support] = [
    new pg.Client({ connectionString: url('migration') }),
    new pg.Client({ connectionString: url('auth') }),
    new pg.Client({ connectionString: url('app') }),
    new pg.Client({ connectionString: url('support') }),
  ];
  await Promise.all([admin.connect(), auth.connect(), app.connect(), support.connect()]);
  pool = createDbPool(url('auth'), { max: 4 });
});

afterAll(async () => {
  await Promise.all([auth.end(), app.end(), support.end(), pool.end()]);
  await admin.end();
});

describe('app.auth_user_id()', () => {
  it('is NULL when nothing is set, and when the setting is empty (no TN001)', async () => {
    expect(await current()).toBeNull();
    expect(await inTx('', current)).toBeNull();
  });

  it('returns the id that was set, and is NULL again after the transaction ends', async () => {
    const id = uuidv7();
    expect(await inTx(id, current)).toBe(id);
    expect(await current()).toBeNull();
  });

  it('refuses a value that is not a UUID (22P02), never a silent cast', async () => {
    expect(await sqlState(inTx('not-a-uuid', current))).toBe('22P02');
  });

  it('is callable by auth_role only: app_role and support_role get 42501', async () => {
    expect(await sqlState(app.query('SELECT app.auth_user_id()'))).toBe('42501');
    expect(await sqlState(support.query('SELECT app.auth_user_id()'))).toBe('42501');
  });

  it('is STABLE, owned by migration_role, and not SECURITY DEFINER (it reads only a setting)', async () => {
    const { rows } = await admin.query(
      `SELECT prosecdef, provolatile, proowner::regrole::text AS owner
       FROM pg_proc WHERE oid = 'app.auth_user_id()'::regprocedure`,
    );
    expect(rows).toEqual([{ prosecdef: false, provolatile: 's', owner: 'migration_role' }]);
  });
});

describe('withAuthUser', () => {
  const read = (tx: Parameters<Parameters<typeof withAuthUser>[2]>[0]) =>
    tx.execute(sql`SELECT app.auth_user_id() AS id`).then((r) => (r.rows[0] as { id: string }).id);

  it('shows the id inside the transaction', async () => {
    const id = uuidv7();
    expect(await withAuthUser(pool, id, read)).toBe(id);
  });

  it('keeps parallel calls apart: each one sees its own id', async () => {
    const [x, y] = [uuidv7(), uuidv7()];
    const slow = (id: string, seconds: number) =>
      withAuthUser(pool, id, async (tx) => {
        await tx.execute(sql`SELECT pg_sleep(${seconds})`);
        return read(tx);
      });
    expect(await Promise.all([slow(x, 0.2), slow(y, 0.01)])).toEqual([x, y]);
  });

  it('leaves nothing on the connection after COMMIT, nor after an error', async () => {
    const single = createDbPool(url('auth'), { max: 1 });
    try {
      await withAuthUser(single, uuidv7(), read);
      const afterCommit = await single.query('SELECT app.auth_user_id() AS id');
      expect(afterCommit.rows[0]).toEqual({ id: null });
      await expect(
        withAuthUser(single, uuidv7(), () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');
      const afterError = await single.query('SELECT app.auth_user_id() AS id');
      expect(afterError.rows[0]).toEqual({ id: null });
    } finally {
      await single.end();
    }
  });

  it('keeps no tenant context: nothing in AsyncLocalStorage, so no code can inherit the identity', async () => {
    await withAuthUser(pool, uuidv7(), (tx) => {
      expect(() => currentTenantContext()).toThrow(TenantContextMissingError);
      return tx.execute(sql`SELECT 1`);
    });
  });
});
