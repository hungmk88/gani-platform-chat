import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../scripts/migrate.mjs';
import { sqlState, url, withClient } from './db.js';

const ORG = '018f0000-0000-7000-8000-000000000001';

describe('roles (spec RLS M01 §3)', () => {
  it('has the four roles with the agreed attributes', async () => {
    const { rows } = await withClient('migration', (c) =>
      c.query<Record<string, unknown>>(
        `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
         FROM pg_roles WHERE rolname IN ('app_role','auth_role','migration_role','support_role') ORDER BY rolname`,
      ),
    );
    const flags = (login: boolean, bypass: boolean) => ({
      rolcanlogin: login,
      rolsuper: false,
      rolbypassrls: bypass,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    expect(rows).toEqual([
      { rolname: 'app_role', ...flags(true, false) },
      { rolname: 'auth_role', ...flags(true, false) },
      { rolname: 'migration_role', ...flags(true, true) },
      { rolname: 'support_role', ...flags(false, false) },
    ]);
  });

  it.each(['app', 'auth'] as const)(
    '%s_role logs no statement text or parameters (spec §3.7)',
    async (role) => {
      const row = await withClient(role, async (c) => {
        const r = await c.query<{ a: string; b: string; c: string }>(
          `SELECT current_setting('log_min_duration_statement') AS a,
                current_setting('log_parameter_max_length') AS b,
                current_setting('log_parameter_max_length_on_error') AS c`,
        );
        return r.rows[0];
      });
      expect(row).toEqual({ a: '-1', b: '0', c: '0' });
    },
  );

  it('app_role cannot create tables or schemas', async () => {
    await withClient('app', async (c) => {
      expect(await sqlState(c.query('CREATE TABLE public.zz_nope (id int)'))).toBe('42501');
      expect(await sqlState(c.query('CREATE SCHEMA zz_nope'))).toBe('42501');
    });
  });

  it('PUBLIC can execute nothing in schema app, also for functions created later', async () => {
    const publicExecutable = `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE s.nspname = 'app' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'`;
    await withClient('migration', async (c) => {
      await c.query('BEGIN');
      await c.query("CREATE FUNCTION app.zz_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'");
      const { rows } = await c.query<{ n: number }>(publicExecutable);
      await c.query('ROLLBACK');
      expect(rows[0]?.n).toBe(0);
    });
  });

  it('PUBLIC has no CREATE on schema public', async () => {
    const { rows } = await withClient('migration', (c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_namespace s
         CROSS JOIN LATERAL aclexplode(coalesce(s.nspacl, acldefault('n', s.nspowner))) a
         WHERE s.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'`,
      ),
    );
    expect(rows[0]?.n).toBe(0);
  });
});

describe('tenant context functions (ADR-004)', () => {
  it('raise TN001 without context, never return NULL or empty', async () => {
    await withClient('app', async (c) => {
      expect(await sqlState(c.query('SELECT app.current_org()'))).toBe('TN001');
      expect(await sqlState(c.query('SELECT app.current_workspaces()'))).toBe('TN001');
    });
  });

  it('return the context set with set_config(..., true) and accept zero workspaces', async () => {
    await withClient('app', async (c) => {
      await c.query('BEGIN');
      await c.query(
        "SELECT set_config('app.current_org', $1, true), set_config('app.current_workspaces', '{}', true)",
        [ORG],
      );
      const { rows } = await c.query<{ org: string; ws: string[] }>(
        'SELECT app.current_org() AS org, app.current_workspaces() AS ws',
      );
      await c.query('COMMIT');
      expect(rows[0]).toEqual({ org: ORG, ws: [] });
    });
  });

  it('still raise TN001 after the transaction ended (setting is "" on that connection, not NULL)', async () => {
    await withClient('app', async (c) => {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
      await c.query('COMMIT');
      expect(await sqlState(c.query('SELECT app.current_org()'))).toBe('TN001');
    });
  });

  it('reject a context that is not a UUID (fail loud, no silent cast)', async () => {
    await withClient('app', async (c) => {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_org', 'not-a-uuid', true)");
      expect(await sqlState(c.query('SELECT app.current_org()'))).toBe('22P02');
      await c.query('ROLLBACK');
    });
  });

  it('are not callable by auth_role (it sees schema app since PR5, but holds no EXECUTE on them)', async () => {
    await withClient('auth', async (c) => {
      expect(await sqlState(c.query('SELECT app.current_org()'))).toBe('42501');
    });
  });
});

describe('migration runner', () => {
  const dirs: string[] = [];
  const TABLE = 'public.schema_migrations_test';
  const GOOD = '209901010000_create_probe.sql';
  const goodSql = '-- rollback: drop table zz_probe\nCREATE TABLE public.zz_probe (id int);\n';
  const run = (dir: string) => migrate({ connectionString: url('migration'), dir, table: TABLE });
  const tempDir = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-test-'));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  };

  afterEach(async () => {
    vi.restoreAllMocks();
    await withClient('migration', (c) => c.query(`DROP TABLE IF EXISTS ${TABLE}, public.zz_probe`));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('has applied the real migrations: a second run applies nothing', async () => {
    expect(await migrate({ connectionString: url('migration') })).toEqual([]);
  });

  it('applies a pending file once, then skips it', async () => {
    const dir = tempDir({ [GOOD]: goodSql });
    expect(await run(dir)).toEqual([GOOD]);
    expect(await run(dir)).toEqual([]);
  });

  it('refuses an applied file that was edited or removed', async () => {
    const dir = tempDir({ [GOOD]: goodSql });
    await run(dir);
    writeFileSync(join(dir, GOOD), goodSql + '-- edited\n');
    await expect(run(dir)).rejects.toThrow(/was modified/);
    rmSync(join(dir, GOOD));
    await expect(run(dir)).rejects.toThrow(/is missing/);
  });

  it('rolls a failing file back completely and records nothing', async () => {
    const dir = tempDir({ [GOOD]: goodSql + 'SELECT 1/0;\n' });
    await expect(run(dir)).rejects.toThrow(/rolled back/);
    await withClient('migration', async (c) => {
      const { rows } = await c.query<{ t: string | null }>(
        "SELECT to_regclass('public.zz_probe') AS t",
      );
      expect(rows[0]?.t).toBeNull();
      expect((await c.query(`SELECT 1 FROM ${TABLE}`)).rowCount).toBe(0);
    });
  });

  it('stops on lint errors before touching the database', async () => {
    const dir = tempDir({ 'bad_name.sql': 'SELECT 1;' });
    await expect(run(dir)).rejects.toThrow(/lint failed/);
    await withClient('migration', async (c) => {
      const { rows } = await c.query<{ t: string | null }>(`SELECT to_regclass('${TABLE}') AS t`);
      expect(rows[0]?.t).toBeNull();
    });
  });

  describe('advisory lock', () => {
    // The session lock is also released when the connection closes, so watch the statements sent instead.
    const sentSql = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.map(([first]) => (typeof first === 'string' ? first : ''));

    it('is released explicitly after a successful run', async () => {
      const spy = vi.spyOn(pg.Client.prototype, 'query');
      await run(tempDir({ [GOOD]: goodSql }));
      const sent = sentSql(spy);
      expect(sent.indexOf('SELECT pg_advisory_unlock($1)')).toBeGreaterThan(
        sent.indexOf('SELECT pg_advisory_lock($1)'),
      );
      expect(sent).toContain('COMMIT');
    });

    it('is released explicitly when a migration fails, and the original error is kept', async () => {
      const spy = vi.spyOn(pg.Client.prototype, 'query');
      const dir = tempDir({ [GOOD]: goodSql + 'SELECT 1/0;\n' });
      await expect(run(dir)).rejects.toThrow(/division by zero/);
      expect(sentSql(spy)).toContain('SELECT pg_advisory_unlock($1)');
    });
  });

  // Review DB-03: CREATE INDEX CONCURRENTLY outside a transaction, and a lock_timeout with retries for the other files.
  describe('locks', () => {
    const INDEX = '209901010001_create_probe_index.sql';
    const ALTER = '209901010002_alter_probe.sql';
    const indexSql =
      '-- rollback: drop index zz_probe_idx\n-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY zz_probe_idx ON public.zz_probe (id);\n';
    const alterSql = '-- rollback: drop column x\nALTER TABLE public.zz_probe ADD COLUMN x int;\n';
    const recorded = () =>
      withClient('migration', async (c) =>
        (await c.query<{ id: string }>(`SELECT id FROM ${TABLE} ORDER BY id`)).rows.map(
          (r) => r.id,
        ),
      );
    /** Another session that holds ACCESS EXCLUSIVE on zz_probe until `release()`. */
    async function holdTable() {
      const holder = new pg.Client({ connectionString: url('migration') });
      await holder.connect();
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE public.zz_probe IN ACCESS EXCLUSIVE MODE');
      return {
        release: async () => {
          await holder.query('ROLLBACK');
          await holder.end();
        },
      };
    }

    it('applies a no-transaction file outside a transaction: CREATE INDEX CONCURRENTLY builds a valid index', async () => {
      const spy = vi.spyOn(pg.Client.prototype, 'query');
      expect(await run(tempDir({ [GOOD]: goodSql, [INDEX]: indexSql }))).toEqual([GOOD, INDEX]);
      const sent = spy.mock.calls.map(([first]) => (typeof first === 'string' ? first : ''));
      // One BEGIN for the transactional file only.
      expect(sent.filter((q) => q === 'BEGIN')).toHaveLength(1);
      await withClient('migration', async (c) => {
        const { rows } = await c.query<{ valid: boolean }>(
          "SELECT indisvalid AS valid FROM pg_index WHERE indexrelid = 'public.zz_probe_idx'::regclass",
        );
        expect(rows).toEqual([{ valid: true }]);
      });
      expect(await recorded()).toEqual([GOOD, INDEX]);
    });

    it('records no no-transaction file while an INVALID index exists, and names it', async () => {
      await run(tempDir({ [GOOD]: goodSql }));
      // A unique build over duplicates fails half way and leaves its index INVALID, as a cut-short CONCURRENTLY build does.
      await withClient('migration', async (c) => {
        await c.query('INSERT INTO public.zz_probe VALUES (1), (1)');
        await c
          .query('CREATE UNIQUE INDEX CONCURRENTLY zz_probe_broken ON public.zz_probe (id)')
          .catch(() => undefined);
      });
      const dir = dirs[dirs.length - 1] as string;
      writeFileSync(join(dir, INDEX), indexSql);
      await expect(run(dir)).rejects.toThrow(
        /INVALID index\(es\) exist: zz_probe_broken; nothing was recorded/,
      );
      expect(await recorded()).toEqual([GOOD]);
    });

    it('sets lock_timeout right after BEGIN of a transactional file', async () => {
      const spy = vi.spyOn(pg.Client.prototype, 'query');
      await migrate({
        connectionString: url('migration'),
        dir: tempDir({ [GOOD]: goodSql }),
        table: TABLE,
        lockTimeoutMs: 1234,
      });
      const sent = spy.mock.calls.map(([first]) => (typeof first === 'string' ? first : ''));
      expect(sent[sent.indexOf('BEGIN') + 1]).toBe('SET LOCAL lock_timeout = 1234');
    });

    it('rolls a file that cannot get its lock back, tries again, and gives up with 55P03 after the last attempt', async () => {
      await run(tempDir({ [GOOD]: goodSql }));
      const dir = dirs[dirs.length - 1] as string;
      writeFileSync(join(dir, ALTER), alterSql);
      const held = await holdTable();
      try {
        const started = Date.now();
        const error: unknown = await migrate({
          connectionString: url('migration'),
          dir,
          table: TABLE,
          lockTimeoutMs: 200,
          attempts: 2,
          retryDelayMs: 50,
        }).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(String(error)).toMatch(/lock not available after 2 attempt/);
        expect((error as { cause?: { code?: string } }).cause?.code).toBe('55P03');
        expect(Date.now() - started).toBeLessThan(5_000);
      } finally {
        await held.release();
      }
      expect(await recorded()).toEqual([GOOD]);
    });

    it('succeeds on a later attempt once the lock is free', async () => {
      await run(tempDir({ [GOOD]: goodSql }));
      const dir = dirs[dirs.length - 1] as string;
      writeFileSync(join(dir, ALTER), alterSql);
      const held = await holdTable();
      const freed = new Promise<void>((resolve) => {
        setTimeout(() => void held.release().then(resolve), 300);
      });
      const applied = await migrate({
        connectionString: url('migration'),
        dir,
        table: TABLE,
        lockTimeoutMs: 200,
        attempts: 3,
        retryDelayMs: 300,
      });
      await freed;
      expect(applied).toEqual([ALTER]);
      expect(await recorded()).toEqual([GOOD, ALTER]);
    });
  });

  it('refuses a tracking table name that is not a plain identifier', async () => {
    await expect(
      migrate({ connectionString: url('migration'), table: 'x; DROP TABLE y' }),
    ).rejects.toThrow(/invalid tracking table/);
  });
});

describe('drizzle-orm with pg', () => {
  it('runs a query as app_role', async () => {
    const pool = new pg.Pool({ connectionString: url('app'), max: 1 });
    try {
      const result = await drizzle({ client: pool }).execute<{ one: number }>(sql`SELECT 1 AS one`);
      expect(result.rows[0]?.one).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
