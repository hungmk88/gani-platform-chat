import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The tables of the custom fields (Tag 2a-ii, T-5/U46, N191): what the database refuses on its own, before any store. Cross-organisation
// reads and "no DELETE" (case 11) are in rls-all-tables.spec, the UPDATE columns of app_role in grants.spec.
const [org, other] = [uuidv7(), uuidv7()];
const users: string[] = [];
let [customer, otherCustomer] = ['', ''];
let admin: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const o of [org, other]) users.push(await seedTenant(admin, o));
  const one = async (o: string) =>
    (await admin.query<{ id: string }>('SELECT id FROM customers WHERE org_id = $1', [o])).rows[0]
      ?.id as string;
  [customer, otherCustomer] = [await one(org), await one(other)];
});

afterAll(async () => {
  await app.end();
  for (const [i, o] of [org, other].entries()) await cleanupTenant(admin, o, users[i] as string);
  await admin.end();
});

/** A field of `org` (as migration_role); resolves to its id, or throws with the SQLSTATE. */
async function field(name: string, type: string, options: string[] = []) {
  const id = uuidv7();
  await admin.query(
    'INSERT INTO customer_field_defs (id, org_id, name, type, options) VALUES ($1, $2, $3, $4, $5)',
    [id, org, name, type, options],
  );
  return id;
}

describe('customer_field_defs', () => {
  it('takes the seven types, a trimmed NFC name of 1 to 100, and choices only for select and multiselect', async () => {
    for (const type of ['text', 'number', 'date', 'phone', 'email'])
      expect(await sqlState(field(`F ${type}`, type))).toBeUndefined();
    expect(await sqlState(field('Khu vực', 'select', ['Q1', 'Q3']))).toBeUndefined();
    expect(await sqlState(field('Nhóm', 'multiselect', ['A', 'B', 'C']))).toBeUndefined();
    expect(await sqlState(field('Sai', 'url'))).toBe('23514');
    expect(await sqlState(field('Một lựa chọn', 'select', ['Q1']))).toBe('23514');
    const many = Array.from({ length: 51 }, (_, i) => `L${i}`);
    expect(await sqlState(field('Quá nhiều', 'multiselect', many))).toBe('23514');
    expect(await sqlState(field('Có lựa chọn', 'text', ['a', 'b']))).toBe('23514');
    for (const bad of ['', ' Ghi chú', 'x'.repeat(101), 'Khách'])
      expect(await sqlState(field(bad, 'text')), JSON.stringify(bad)).toBe('23514');
  });
});

describe('customer_field_values', () => {
  const set = (customerId: string, fieldId: string, value: unknown, client = admin) =>
    client.query(
      'INSERT INTO customer_field_values (id, org_id, customer_id, field_id, value) VALUES ($1, $2, $3, $4, $5)',
      [uuidv7(), org, customerId, fieldId, JSON.stringify(value)],
    );

  it('keeps one value per customer and field, of a string, a number or a list, inside the organisation', async () => {
    const f = await field('Giá trị', 'text');
    expect(await sqlState(set(customer, f, 'Quận 3'))).toBeUndefined();
    expect(await sqlState(set(customer, f, 'lần hai'))).toBe('23505');
    const n = await field('Số', 'number');
    expect(await sqlState(set(customer, n, 12))).toBeUndefined();
    const b = await field('Đúng sai', 'text');
    expect(await sqlState(set(customer, b, true))).toBe('23514');
    expect(await sqlState(set(otherCustomer, f, 'x'))).toBe('23503');
  });

  it('lets app_role set and clear a value, never move it nor delete it, and keeps the value from support_role', async () => {
    const f = await field('Quyền', 'text');
    const write = (sql: string, params: unknown[] = []) =>
      asApp(app, org, [], () => sqlState(app.query(sql, params)));
    expect(
      await write(
        'INSERT INTO customer_field_values (id, org_id, customer_id, field_id, value) VALUES ($1, $2, $3, $4, $5)',
        [uuidv7(), org, customer, f, JSON.stringify('A')],
      ),
    ).toBeUndefined();
    expect(
      await write('UPDATE customer_field_values SET value = NULL WHERE field_id = $1', [f]),
    ).toBeUndefined();
    expect(await write('UPDATE customer_field_values SET field_id = field_id')).toBe('42501');
    expect(await write('UPDATE customer_field_values SET customer_id = customer_id')).toBe('42501');
    expect(await write('DELETE FROM customer_field_values WHERE field_id = $1', [f])).toBe('42501');
    expect(await write('DELETE FROM customer_field_defs WHERE id = $1', [f])).toBe('42501');
    const { rows } = await admin.query<{ column: string }>(
      `SELECT a.attname AS column FROM pg_attribute a
       WHERE a.attrelid = 'public.customer_field_values'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND NOT has_column_privilege('support_role', a.attrelid, a.attnum, 'SELECT')`,
    );
    expect(rows.map((r) => r.column).sort()).toEqual(['value', 'value_enc']);
  });
});

describe('customer_field_values, encrypted (Tag 2b)', () => {
  const sealed = () => randomBytes(12 + 16 + 8);
  /** A row of `customer` for a new field with this value, ciphertext and key version; resolves to the SQLSTATE, or undefined. */
  const row = async (value: unknown, valueEnc: Buffer | null, keyVersion: number | null) =>
    sqlState(
      admin.query(
        `INSERT INTO customer_field_values (id, org_id, customer_id, field_id, value, value_enc, key_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          uuidv7(),
          org,
          customer,
          await field(`Mã ${uuidv7()}`, 'text'),
          value === null ? null : JSON.stringify(value),
          valueEnc,
          keyVersion,
        ],
      ),
    );

  it('holds a plain or an encrypted value, never both, and a key version exactly with a ciphertext', async () => {
    expect(await row(null, sealed(), 1)).toBeUndefined();
    expect(await row('rõ', null, null)).toBeUndefined();
    expect(await row(null, null, null)).toBeUndefined();
    expect(await row('rõ', sealed(), 1)).toBe('23514');
    expect(await row(null, sealed(), null)).toBe('23514');
    expect(await row(null, null, 1)).toBe('23514');
    expect(await row(null, sealed(), 0)).toBe('23514');
  });

  it('lets app_role set, re-encrypt and clear a ciphertext', async () => {
    const f = await field('Mã hóa', 'text');
    const write = (sql: string, params: unknown[] = []) =>
      asApp(app, org, [], () => sqlState(app.query(sql, params)));
    expect(
      await write(
        `INSERT INTO customer_field_values (id, org_id, customer_id, field_id, value_enc, key_version)
         VALUES ($1, $2, $3, $4, $5, 1)`,
        [uuidv7(), org, customer, f, sealed()],
      ),
    ).toBeUndefined();
    expect(
      await write(
        'UPDATE customer_field_values SET value_enc = $2, key_version = 2 WHERE field_id = $1',
        [f, sealed()],
      ),
    ).toBeUndefined();
    expect(
      await write(
        'UPDATE customer_field_values SET value_enc = NULL, key_version = NULL WHERE field_id = $1',
        [f],
      ),
    ).toBeUndefined();
  });
});
