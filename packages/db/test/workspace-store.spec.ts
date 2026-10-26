import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  listWorkspaces,
  lockWorkspace,
  updateWorkspace,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The workspaces of /settings/workspace (N157), through RLS: the organisation of the transaction only, deleted ones never.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;
const inOrg = <T>(org: string, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: org, workspaceIds: [] }, fn);
const [extra, gone] = [uuidv7(), uuidv7()];
let ofB = '';

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  // prettier-ignore
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template, deleted_at) VALUES ($1, $3, 'b2b', 'Bán sỉ', 'b2b_sales', NULL), ($2, $3, 'old', 'Cũ', 'service', now())`,
    [extra, gone, A]);
  ofB = (await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [B]))
    .rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('workspace-store', () => {
  it('lists the workspaces of the current org that are not deleted, by name', async () => {
    const rows = await inOrg(A, (tx) => listWorkspaces(tx));
    expect(
      rows.map((r) => [r.slug, r.name, r.template, r.timezone, r.defaultMaxConcurrent]),
    ).toEqual([
      ['b2b', 'Bán sỉ', 'b2b_sales', 'Asia/Ho_Chi_Minh', 5],
      ['ws', 'W', 'service', 'Asia/Ho_Chi_Minh', 5],
    ]);
  });

  it('locks and changes a workspace of the current org only; slug and template stay', async () => {
    const changed = await inOrg(A, async (tx) => {
      expect(await lockWorkspace(tx, extra)).toMatchObject({ id: extra, name: 'Bán sỉ' });
      return updateWorkspace(tx, extra, {
        name: 'Bán sỉ miền Nam',
        timezone: 'Asia/Bangkok',
        defaultMaxConcurrent: 7,
        contactPhone: '+84 28 1234 5678',
      });
    });
    expect(changed).toMatchObject({
      id: extra,
      slug: 'b2b',
      template: 'b2b_sales',
      name: 'Bán sỉ miền Nam',
      timezone: 'Asia/Bangkok',
      defaultMaxConcurrent: 7,
      contactPhone: '+84 28 1234 5678',
    });
    expect(await inOrg(A, (tx) => lockWorkspace(tx, ofB))).toBeNull();
    expect(await inOrg(A, (tx) => lockWorkspace(tx, gone))).toBeNull();
    // Nothing of B changes from A, even naming its id.
    const nameOfB = async () =>
      (await admin.query<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [ofB]))
        .rows[0]!.name;
    const before = await nameOfB();
    await inOrg(A, (tx) => updateWorkspace(tx, ofB, { name: 'X' })).catch(() => undefined);
    expect(await nameOfB()).toBe(before);
  });

  it('keeps the CHECKs: a blank name, a limit below 1 and a contact number with letters are refused', async () => {
    await expect(inOrg(A, (tx) => updateWorkspace(tx, extra, { name: '  ' }))).rejects.toThrow();
    await expect(
      inOrg(A, (tx) => updateWorkspace(tx, extra, { contactPhone: 'gọi 1900' })),
    ).rejects.toThrow();
    await expect(
      inOrg(A, (tx) => updateWorkspace(tx, extra, { defaultMaxConcurrent: 0 })),
    ).rejects.toThrow();
  });
});
