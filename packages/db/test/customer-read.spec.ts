import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  customerForContact,
  InvalidCursorError,
  listCustomers,
  loadCustomer,
  withTenant,
  type TenantTx,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// What the Khách hàng screens read (N165), on app_role with RLS: the live customers of the organisation newest first, by pages, found
// by a part of the name or the start of a number; the identities without their external id; deleted ones and another org's hidden.
const [A, B] = [uuidv7(), uuidv7()];
let [userA, userB, CA] = ['', '', ''];
const id: Record<string, string> = {};
let admin: pg.Client;
let pool: pg.Pool;

const inA = <T>(fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(pool, { orgId: A, workspaceIds: [] }, fn);
const list = (q: Parameters<typeof listCustomers>[1]) => inA((tx) => listCustomers(tx, q));
const names = (page: { rows: readonly { displayName: string | null }[] }) =>
  page.rows.map((r) => r.displayName);
const customer = async (org: string, key: string, name: string, phone: string | null) => {
  id[key] = uuidv7();
  await admin.query(
    'INSERT INTO customers (id, org_id, display_name, phone_e164) VALUES ($1, $2, $3, $4)',
    [id[key], org, name, phone],
  );
};

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 3 });
  [userA, userB] = [await seedTenant(admin, A), await seedTenant(admin, B)];
  CA = (
    (await admin.query<{ id: string }>('SELECT id FROM channel_accounts WHERE org_id = $1', [A]))
      .rows[0] as { id: string }
  ).id;
  // The fixtures' customer of each org is the oldest; these follow in this order (UUIDv7: newest last).
  await customer(A, 'lan', 'Nguyễn Thị Lan', '+84912345678');
  await customer(A, 'lam', 'Trần Văn Lâm', '+84987654321');
  await customer(A, 'odd', 'Cửa hàng 50%_off', null);
  await customer(A, 'gone', 'Lan đã xóa', '+84912000000');
  await admin.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [id['gone']]);
  await customer(B, 'theirs', 'Lan của B', '+84912999999');
  // The same address in both organisations: a search of A never finds B's.
  for (const key of ['lan', 'theirs'])
    await admin.query('UPDATE customers SET email = $1 WHERE id = $2', [
      'lan@example.test',
      id[key],
    ]);
});

afterAll(async () => {
  await pool.end();
  await cleanupTenant(admin, A, userA);
  await cleanupTenant(admin, B, userB);
  await admin.end();
});

describe('listCustomers', () => {
  it('gives the live customers of the organisation newest first, page by page with no row twice', async () => {
    const all = await list({ limit: 100 });
    expect(names(all).slice(0, 3)).toEqual(['Cửa hàng 50%_off', 'Trần Văn Lâm', 'Nguyễn Thị Lan']);
    expect(names(all)).not.toContain('Lan đã xóa');
    expect(names(all)).not.toContain('Lan của B');
    const first = await list({ limit: 2 });
    const next = await list({ limit: 2, cursor: first.nextCursor ?? '' });
    expect([...first.rows, ...next.rows].map((r) => r.id)).toEqual(
      all.rows.slice(0, 4).map((r) => r.id),
    );
  });

  it('finds by a part of the name in any case, with % and _ as letters, and by the start of a number', async () => {
    expect(names(await list({ limit: 10, name: 'LAN' }))).toEqual(['Nguyễn Thị Lan']);
    expect(names(await list({ limit: 10, name: '50%_' }))).toEqual(['Cửa hàng 50%_off']);
    expect(names(await list({ limit: 10, name: '%' }))).toEqual(['Cửa hàng 50%_off']);
    expect(names(await list({ limit: 10, phonePrefix: '+84912' }))).toEqual(['Nguyễn Thị Lan']);
    expect(names(await list({ limit: 10, phonePrefix: '+849' }))).toEqual([
      'Trần Văn Lâm',
      'Nguyễn Thị Lan',
    ]);
  });

  it('finds by a whole email only (U48): never a part of one, nor another organisation’s', async () => {
    expect(names(await list({ limit: 10, email: 'lan@example.test' }))).toEqual(['Nguyễn Thị Lan']);
    for (const part of ['lan@example', '@example.test', 'lan@%'])
      expect(names(await list({ limit: 10, email: part })), part).toEqual([]);
  });

  it('refuses a cursor it did not give and a limit out of 1..100', async () => {
    await expect(list({ limit: 10, cursor: 'bm90IG91cnM' })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
    await expect(list({ limit: 0 })).rejects.toThrow(RangeError);
  });
});

describe('loadCustomer', () => {
  it('gives one live customer with how the channels know them, never the external id', async () => {
    const made = await inA((tx) =>
      customerForContact(tx, { channelAccountId: CA, externalUserId: 'zu-read', newId: uuidv7 }),
    );
    const view = await inA((tx) => loadCustomer(tx, made));
    expect(view).toMatchObject({
      id: made,
      displayName: null,
      humanOnly: false,
      identities: [{ type: 'zalo_uid', channelAccountId: CA, verification: 'unverified' }],
    });
    expect(JSON.stringify(view)).not.toContain('zu-read');
    expect((await inA((tx) => loadCustomer(tx, id['lan'] ?? '')))?.identities).toEqual([]);
  });

  it('gives null for a deleted customer, one of another organisation (RLS) and one that does not exist', async () => {
    for (const key of [id['gone'], id['theirs'], uuidv7()])
      expect(await inA((tx) => loadCustomer(tx, key ?? ''))).toBeNull();
  });
});
