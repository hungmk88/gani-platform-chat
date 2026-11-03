import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  createField,
  deleteField,
  FIELD_LIMIT,
  FieldHasDataError,
  FieldLimitError,
  listFields,
  lockField,
  updateField,
  withTenant,
  type FieldType,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The custom fields of a company (Tag 3b-i-a, N191) through RLS: at most FIELD_LIMIT live fields, one maker at a time; a field with
// data keeps its type, sensitivity and choices in use and is never deleted, only hidden.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const customerOf = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;
const inOrg = <T>(org: string, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: org, workspaceIds: [] }, fn);
const failure = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );
const make = (
  name: string,
  type: FieldType = 'text',
  more: { options?: string[]; sensitive?: boolean } = {},
  org = A,
) =>
  inOrg(org, (tx) =>
    createField(tx, {
      id: uuidv7(),
      name,
      type,
      options: more.options ?? [],
      required: false,
      sensitive: more.sensitive ?? false,
    }),
  );
const change = (id: string, c: Parameters<typeof updateField>[2]) =>
  inOrg(A, async (tx) => updateField(tx, (await lockField(tx, id))!, c));

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) {
    seedUsers.set(org, await seedTenant(admin, org));
    const { rows } = await admin.query<{ id: string }>(
      'SELECT id FROM customers WHERE org_id = $1',
      [org],
    );
    customerOf.set(org, rows[0]!.id);
  }
  // The seed field of fixtures.ts is out of the way of these tests.
  await admin.query('UPDATE customer_field_defs SET deleted_at = now() WHERE org_id = $1', [A]);
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('customer-field-store', () => {
  it('makes fields last in the order, lists them by position with hasData, each company its own', async () => {
    const zone = await make('Khu vực', 'select', { options: ['Bắc', 'Nam'] });
    const note = await make('Ghi chú'.normalize('NFD'));
    expect(note).toMatchObject({ name: 'Ghi chú', position: zone.position + 1, hasData: false });
    expect((await inOrg(A, listFields)).map((f) => f.name)).toEqual(['Khu vực', 'Ghi chú']);
    expect((await inOrg(B, listFields)).map((f) => [f.name, f.hasData])).toEqual([['Seed', true]]);
    expect(await inOrg(B, (tx) => lockField(tx, zone.id))).toBeNull();
  });

  it('keeps the type, the sensitivity and the choices in use of a field with data, and only hides it', async () => {
    const pack = await make('Đóng gói', 'select', { options: ['Hộp', 'Thùng', 'Bao'] });
    expect((await change(pack.id, { options: ['Hộp', 'Thùng'] })).options).toEqual([
      'Hộp',
      'Thùng',
    ]);
    await admin.query(
      `INSERT INTO customer_field_values (id, org_id, customer_id, field_id, value) VALUES ($1, $2, $3, $4, '"Thùng"')`,
      [uuidv7(), A, customerOf.get(A), pack.id],
    );
    expect((await inOrg(A, (tx) => lockField(tx, pack.id)))!.hasData).toBe(true);
    for (const c of [{ type: 'text' as const }, { sensitive: true }, { options: ['Hộp', 'Kiện'] }])
      expect(await failure(change(pack.id, c))).toBeInstanceOf(FieldHasDataError);
    expect((await change(pack.id, { options: ['Thùng', 'Kiện'], name: 'Bao bì' })).name).toBe(
      'Bao bì',
    );
    expect(
      await failure(inOrg(A, async (tx) => deleteField(tx, (await lockField(tx, pack.id))!))),
    ).toBeInstanceOf(FieldHasDataError);
    expect((await change(pack.id, { hidden: true })).hidden).toBe(true);
    const spare = await make('Bỏ');
    expect((await change(spare.id, { type: 'number' })).type).toBe('number');
    await inOrg(A, async (tx) => deleteField(tx, (await lockField(tx, spare.id))!));
    expect((await inOrg(A, listFields)).map((f) => f.id)).not.toContain(spare.id);
  });

  it(`stops at ${FIELD_LIMIT} live fields, one maker at a time, ended ones aside`, async () => {
    const live = (await inOrg(A, listFields)).length;
    await admin.query(
      `INSERT INTO customer_field_defs (id, org_id, name, type) SELECT id, $2, 'Lô ' || n, 'text' FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, n)`,
      [Array.from({ length: FIELD_LIMIT - 1 - live }, () => uuidv7()), A],
    );
    // The first maker holds its transaction open while the second counts: without the lock both would see FIELD_LIMIT - 1.
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const first = inOrg(A, async (tx) => {
      await createField(tx, {
        id: uuidv7(),
        name: 'Cuối 1',
        type: 'text',
        options: [],
        required: false,
        sensitive: false,
      });
      await wait(400);
    });
    await wait(100);
    const second = await failure(make('Cuối 2'));
    await first;
    expect(second).toBeInstanceOf(FieldLimitError);
    expect((await inOrg(A, listFields)).length).toBe(FIELD_LIMIT);
  });
});
