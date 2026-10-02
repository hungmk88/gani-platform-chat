import { uuidv7 } from '@gani/domain';
import { eq, getTableColumns } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  InvalidTenantContextError,
  TenantContextMissingError,
  createDbPool,
  currentTenantContext,
  organizations,
  runWithTenantContext,
  withCurrentTenant,
  withTenant,
  type TenantTx,
} from '../src/index.js';
import { sqlState, url, withClient } from './db.js';

// Spec RLS M01 §7 cases 1, 2 (and the part of 11 that concerns organizations).
const A = uuidv7();
const B = uuidv7();
const created = [A, B];
let pool: pg.Pool;

const ids = (tx: TenantTx) => tx.select({ id: organizations.id }).from(organizations);
const newOrg = (id: string) => ({ id, slug: `t-${id}`, name: 'Test org' });
const track = (id: string) => {
  created.push(id);
  return id;
};
const ctx = (orgId: string) => ({ orgId, workspaceIds: [] });

beforeAll(async () => {
  pool = createDbPool(url('app'), { max: 2 });
  await withClient('migration', async (c) => {
    await c.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3), ($4, $5, $6)', [
      A,
      `t-${A}`,
      'Org A',
      B,
      `t-${B}`,
      'Org B',
    ]);
  });
});

afterAll(async () => {
  await pool.end();
  await withClient('migration', (c) =>
    c.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [created]),
  );
});

describe('case 1: no TenantTx raises TN001, it does not return 0 rows', () => {
  it.each([
    ['SELECT', 'SELECT id FROM organizations', []],
    ['UPDATE', "UPDATE organizations SET name = 'x'", []],
    ['INSERT', "INSERT INTO organizations (id, slug, name) VALUES ($1, 'x', 'x')", [uuidv7()]],
  ] as const)('%s', async (_name, text, values) => {
    await withClient('app', async (c) => {
      expect(await sqlState(c.query(text, [...values]))).toBe('TN001');
    });
  });
});

describe('case 2: writing for another tenant is refused (42501)', () => {
  it('rejects INSERT with another id, and changing the id of the own row', async () => {
    const other = uuidv7();
    expect(
      await sqlState(
        withTenant(pool, ctx(A), (tx) => tx.insert(organizations).values(newOrg(other))),
      ),
    ).toBe('42501');
    expect(
      await sqlState(
        withTenant(pool, ctx(A), (tx) =>
          tx.update(organizations).set({ id: other }).where(eq(organizations.id, A)),
        ),
      ),
    ).toBe('42501');
  });

  it('lets a tenant create and read its own row (positive control)', async () => {
    const own = track(uuidv7());
    await withTenant(pool, ctx(own), (tx) => tx.insert(organizations).values(newOrg(own)));
    expect(await withTenant(pool, ctx(own), ids)).toEqual([{ id: own }]);
  });
});

describe('isolation between tenants', () => {
  it('shows only the own row', async () => {
    expect(await withTenant(pool, ctx(A), ids)).toEqual([{ id: A }]);
    expect(await withTenant(pool, ctx(B), ids)).toEqual([{ id: B }]);
  });

  it("updates 0 rows of another tenant's organization", async () => {
    const updated = await withTenant(pool, ctx(A), (tx) =>
      tx
        .update(organizations)
        .set({ name: 'hacked' })
        .where(eq(organizations.id, B))
        .returning({ id: organizations.id }),
    );
    expect(updated).toEqual([]);
    const name = await withClient('migration', (c) =>
      c.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [B]),
    );
    expect(name.rows[0]?.name).toBe('Org B');
  });

  it('gives app_role no DELETE and auth_role no access (case 11)', async () => {
    await withClient('app', async (c) => {
      expect(await sqlState(c.query('DELETE FROM organizations WHERE false'))).toBe('42501');
    });
    await withClient('auth', async (c) => {
      expect(await sqlState(c.query('SELECT id FROM organizations'))).toBe('42501');
    });
  });
});

describe('RLS configuration of organizations', () => {
  it('has ENABLE and FORCE ROW LEVEL SECURITY and exactly one policy', async () => {
    await withClient('migration', async (c) => {
      const cls = await c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.organizations'::regclass",
      );
      expect(cls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      const pol = await c.query<{ policyname: string; cmd: string; roles: string[] }>(
        "SELECT policyname, cmd, roles::text[] AS roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organizations'",
      );
      expect(pol.rows).toEqual([
        { policyname: 'organizations_app', cmd: 'ALL', roles: ['app_role'] },
      ]);
    });
  });

  it('matches the Drizzle schema (names, types, nullability)', async () => {
    const fromDrizzle = Object.values(getTableColumns(organizations))
      .map((col) => ({ name: col.name, type: col.getSQLType(), nullable: !col.notNull }))
      .sort((x, y) => x.name.localeCompare(y.name));
    const fromDb = await withClient('migration', (c) =>
      c.query<{ name: string; type: string; nullable: boolean }>(
        `SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizations'
         ORDER BY column_name`,
      ),
    );
    expect(fromDb.rows).toEqual(fromDrizzle);
  });
});

describe('withTenant', () => {
  it('does not leak the context to the next user of the connection', async () => {
    const single = createDbPool(url('app'), { max: 1 });
    try {
      expect(await withTenant(single, ctx(A), ids)).toEqual([{ id: A }]);
      expect(await sqlState(single.query('SELECT id FROM organizations'))).toBe('TN001');
    } finally {
      await single.end();
    }
  });

  it('rolls back when fn throws', async () => {
    const id = track(uuidv7());
    await expect(
      withTenant(pool, ctx(id), async (tx) => {
        await tx.insert(organizations).values(newOrg(id));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const left = await withClient('migration', (c) =>
      c.query('SELECT 1 FROM organizations WHERE id = $1', [id]),
    );
    expect(left.rowCount).toBe(0);
  });

  it('keeps two tenants apart when they run at the same time', async () => {
    const results = await Promise.all([
      withTenant(pool, ctx(A), ids),
      withTenant(pool, ctx(B), ids),
      withTenant(pool, ctx(A), ids),
    ]);
    expect(results).toEqual([[{ id: A }], [{ id: B }], [{ id: A }]]);
  });

  it('rejects a context that is not a UUID before taking a connection', async () => {
    const unreachable = createDbPool('postgres://nobody@127.0.0.1:1/none', { max: 1 });
    try {
      await expect(withTenant(unreachable, ctx('x'), ids)).rejects.toThrow(
        InvalidTenantContextError,
      );
      await expect(
        withTenant(unreachable, { orgId: A, workspaceIds: ['{x}'] }, ids),
      ).rejects.toThrow(InvalidTenantContextError);
    } finally {
      await unreachable.end();
    }
  });

  it('nested: the inner context replaces the outer one inside itself only', async () => {
    const seen = await withTenant(pool, ctx(A), async (outer) => {
      const inner = await withTenant(pool, ctx(B), async (tx) => ({
        rows: await ids(tx),
        org: currentTenantContext().orgId,
      }));
      return { inner, outerRows: await ids(outer), outerOrg: currentTenantContext().orgId };
    });
    expect(seen).toEqual({
      inner: { rows: [{ id: B }], org: B },
      outerRows: [{ id: A }],
      outerOrg: A,
    });
  });

  it('withCurrentTenant takes the context from the surrounding scope, and fails without one', async () => {
    expect(await runWithTenantContext(ctx(A), () => withCurrentTenant(pool, ids))).toEqual([
      { id: A },
    ]);
    await expect(withCurrentTenant(pool, ids)).rejects.toThrow(TenantContextMissingError);
  });
});
