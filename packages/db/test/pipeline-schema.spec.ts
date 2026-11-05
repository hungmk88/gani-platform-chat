import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The tables of a workspace's pipeline (L1a, N196, N200): what the database refuses on its own, before any store or command. Every RLS
// table is also covered by rls-all-tables.spec (cross-organisation read, O+W policies, no DELETE) and grants.spec (no UPDATE column).
const [org, other] = [uuidv7(), uuidv7()];
const users: string[] = [];
const ids = { ws: '', ws2: '', otherWs: '' };
let admin: pg.Client;
let app: pg.Client;
let place = 100;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const o of [org, other]) users.push(await seedTenant(admin, o));
  const ws = async (o: string) =>
    (await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [o])).rows[0]
      ?.id as string;
  ids.ws = await ws(org);
  ids.otherWs = await ws(other);
  ids.ws2 = uuidv7();
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')`,
    [ids.ws2, org],
  );
  // The seed rows of fixtures.ts sit at position 0: these tests use their own places.
  await admin.query(
    `INSERT INTO pipeline_stages (id, org_id, workspace_id, name, position) VALUES ($1, $2, $3, 'Bước 1', 1)`,
    [uuidv7(), org, ids.ws2],
  );
});

afterAll(async () => {
  await app.end();
  for (const [i, o] of [org, other].entries()) await cleanupTenant(admin, o, users[i] as string);
  await admin.end();
});

/** A row of `table` in `org`'s workspace (as migration_role), with `over` replacing columns; resolves to the SQLSTATE or undefined. */
function insert(
  table: 'pipeline_stages' | 'pipeline_lost_reasons',
  over: Record<string, string | number> = {},
  client = admin,
) {
  const row: Record<string, string | number> = {
    id: uuidv7(),
    org_id: org,
    workspace_id: ids.ws,
    name: 'Bước',
    position: place++,
    ...over,
  };
  const cols = Object.keys(row);
  return sqlState(
    client.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row),
    ),
  );
}

describe('pipeline_stages', () => {
  it('takes a step of 1 to 100 characters, trimmed and in NFC, at one free place of the workspace', async () => {
    // Place 1 is taken in ws2 (beforeAll): a place is unique in a workspace, not across workspaces.
    expect(await insert('pipeline_stages', { name: 'x'.repeat(100), position: 1 })).toBeUndefined();
    expect(await insert('pipeline_stages', { position: 1 })).toBe('23505');
    expect(await insert('pipeline_stages', { workspace_id: ids.ws2, position: 1 })).toBe('23505');
    for (const over of [
      { name: '' },
      { name: ' Bước 2' },
      { name: 'x'.repeat(101) },
      { name: 'Bước 2'.normalize('NFD') },
      { position: -1 },
    ])
      expect(await insert('pipeline_stages', over), JSON.stringify(over).slice(0, 60)).toBe(
        '23514',
      );
  });

  it('ties a step to a workspace of its own organisation', async () => {
    expect(await insert('pipeline_stages', { workspace_id: ids.otherWs })).toBe('23503');
  });
});

describe('pipeline_lost_reasons', () => {
  it('takes a reason of 1 to 200 characters in NFC, one name and one place a list, a new list at a later effective_from', async () => {
    const at = '2026-11-05T00:00:00Z';
    expect(
      await insert('pipeline_lost_reasons', {
        name: 'Khác (chờ Q9)',
        position: 1,
        effective_from: at,
      }),
    ).toBeUndefined();
    expect(
      await insert('pipeline_lost_reasons', { name: 'y'.repeat(200), effective_from: at }),
    ).toBeUndefined();
    expect(
      await insert('pipeline_lost_reasons', { name: 'khác (chờ q9)', effective_from: at }),
    ).toBe('23505');
    expect(await insert('pipeline_lost_reasons', { position: 1, effective_from: at })).toBe(
      '23505',
    );
    expect(
      await insert('pipeline_lost_reasons', { name: 'Khác (chờ Q9)', effective_from: at }),
    ).toBe('23505');
    // The same place, and the same name, in the list of another workspace at the same time.
    expect(
      await insert('pipeline_lost_reasons', {
        workspace_id: ids.ws2,
        name: 'Khác (chờ Q9)',
        position: 1,
        effective_from: at,
      }),
    ).toBeUndefined();
    // One name a list, in force or not: the rule holds for a list set for later too.
    const later = '2027-06-01T00:00:00Z';
    expect(
      await insert('pipeline_lost_reasons', { name: 'Hết hàng', effective_from: later }),
    ).toBeUndefined();
    expect(
      await insert('pipeline_lost_reasons', {
        name: 'HẾT HÀNG'.toLowerCase(),
        effective_from: later,
      }),
    ).toBe('23505');
    // The same name and place in the list that follows.
    expect(
      await insert('pipeline_lost_reasons', {
        name: 'Khác (chờ Q9)',
        position: 1,
        effective_from: '2026-12-01T00:00:00Z',
      }),
    ).toBeUndefined();
    for (const over of [
      { name: '  ' },
      { name: 'y'.repeat(201) },
      { name: 'Giá cao'.normalize('NFD') },
      { position: -1 },
    ])
      expect(await insert('pipeline_lost_reasons', over), JSON.stringify(over).slice(0, 60)).toBe(
        '23514',
      );
    expect(await insert('pipeline_lost_reasons', { workspace_id: ids.otherWs })).toBe('23503');
  });
});

describe('app_role and support_role', () => {
  it('let app_role read the pipeline of the workspaces of its session only, and never write it', async () => {
    const seen = (workspaces: string[], tenant = org) =>
      asApp(app, tenant, workspaces, async () =>
        (
          await app.query<{ w: string }>(
            'SELECT DISTINCT workspace_id::text AS w FROM pipeline_stages ORDER BY 1',
          )
        ).rows.map((r) => r.w),
      );
    expect(await seen([ids.ws2])).toEqual([ids.ws2]);
    expect((await seen([ids.ws, ids.ws2])).sort()).toEqual([ids.ws, ids.ws2].sort());
    expect(await seen([ids.ws2], other)).toEqual([]);
    for (const table of ['pipeline_stages', 'pipeline_lost_reasons'] as const) {
      expect(await asApp(app, org, [ids.ws], () => insert(table, {}, app)), table).toBe('42501');
      for (const sql of [
        `UPDATE ${table} SET name = name`,
        `UPDATE ${table} SET position = position`,
      ])
        expect(await asApp(app, org, [ids.ws], () => sqlState(app.query(sql))), sql).toBe('42501');
    }
  });

  it('let support_role read every column: a step or a reason names no customer', async () => {
    const { rows } = await admin.query<{ t: string; column: string }>(
      `SELECT a.attrelid::regclass::text AS t, a.attname AS column FROM pg_attribute a
       WHERE a.attrelid IN ('public.pipeline_stages'::regclass, 'public.pipeline_lost_reasons'::regclass)
         AND a.attnum > 0 AND NOT a.attisdropped
         AND NOT has_column_privilege('support_role', a.attrelid, a.attnum, 'SELECT')`,
    );
    expect(rows).toEqual([]);
  });
});
