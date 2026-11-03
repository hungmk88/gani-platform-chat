import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  createField,
  FIELD_VALUE_COLUMN,
  FieldNotFoundError,
  FieldValueInvalidError,
  listFields,
  readFieldValues,
  setFieldValues,
  withTenant,
  type FieldOpen,
  type FieldSeal,
  type FieldType,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The values of the custom fields of a customer (Tag 3b-i-b, N191) through RLS: only the fields named change, null clears one and
// deletes nothing; a sensitive value is written only through `seal` (here a fake that binds the row id, the real SecretBox is the
// API's) and never in clear, and read opened or sealed.
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
const seals: string[] = [];
/** A fake of SecretBox: the "ciphertext" names the row it belongs to, and `open` refuses another row. */
const seal: FieldSeal = (rowId, plaintext) => {
  seals.push(rowId);
  return {
    enc: Buffer.from(`${rowId}|${Buffer.from(plaintext).toString('base64')}`),
    keyVersion: 7,
  };
};
const open: FieldOpen = (rowId, enc, keyVersion) => {
  const [row, body] = enc.toString().split('|');
  if (row !== rowId || keyVersion !== 7) throw new Error('wrong row or key');
  return Buffer.from(body!, 'base64').toString();
};
const set = (values: { fieldId: string; value: unknown }[], customer = customerOf.get(A)!) =>
  inOrg(A, (tx) => setFieldValues(tx, customer, values as never, seal));

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

describe('customer-field-value-store', () => {
  it('writes a sensitive value only sealed, bound to its row, and reads it opened or sealed', async () => {
    const [plain, secret] = [
      await make('Màu'),
      await make('Số tài khoản', 'text', { sensitive: true }),
    ];
    seals.length = 0;
    await set([
      { fieldId: plain.id, value: 'xanh' },
      { fieldId: secret.id, value: '0123456789' },
    ]);
    const { rows } = await admin.query<{
      id: string;
      value: unknown;
      enc: Buffer | null;
      kv: number | null;
    }>(
      'SELECT id, value, value_enc AS enc, key_version AS kv FROM customer_field_values WHERE field_id = $1',
      [secret.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: null, kv: 7 });
    expect(rows[0]!.enc!.toString()).not.toContain('0123456789');
    expect(seals).toEqual([rows[0]!.id]);
    expect(FIELD_VALUE_COLUMN).toBe('customer_field_values.value_enc');
    const read = async (o?: FieldOpen) =>
      (await inOrg(A, (tx) => readFieldValues(tx, customerOf.get(A)!, o)))!.filter((v) =>
        [plain.id, secret.id].includes(v.fieldId),
      );
    expect(await read(open)).toEqual([
      { fieldId: plain.id, value: 'xanh', sealed: false },
      { fieldId: secret.id, value: '0123456789', sealed: false },
    ]);
    expect(await read()).toEqual([
      { fieldId: plain.id, value: 'xanh', sealed: false },
      { fieldId: secret.id, value: null, sealed: true },
    ]);
    // The same row again, then cleared: nothing deleted, every column back to NULL.
    await set([{ fieldId: secret.id, value: '9999' }]);
    expect(seals).toEqual([rows[0]!.id, rows[0]!.id]);
    await set([{ fieldId: secret.id, value: null }]);
    const after = await admin.query(
      'SELECT value, value_enc, key_version FROM customer_field_values WHERE field_id = $1',
      [secret.id],
    );
    expect(after.rows).toEqual([{ value: null, value_enc: null, key_version: null }]);
    expect(await read()).toEqual([{ fieldId: plain.id, value: 'xanh', sealed: false }]);
  });

  it('refuses a field of another company and gives null for a customer that is not one', async () => {
    const [theirs] = await inOrg(B, listFields);
    expect(await failure(set([{ fieldId: theirs!.id, value: 'x' }]))).toBeInstanceOf(
      FieldNotFoundError,
    );
    expect(await set([], uuidv7())).toBeNull();
    expect(await inOrg(A, (tx) => readFieldValues(tx, customerOf.get(B)!))).toBeNull();
  });

  it('writes what `fit` gives for a value of its field, and nothing at all when it refuses one', async () => {
    const size = await make('Cỡ', 'select', { options: ['S', 'M'] });
    const seen: unknown[] = [];
    const fit = (field: { type: string; options: readonly string[] }, value: unknown) => {
      seen.push([field.type, field.options]);
      return typeof value === 'string' && field.options.includes(value.trim())
        ? value.trim()
        : undefined;
    };
    const put = (value: string) =>
      inOrg(A, (tx) =>
        setFieldValues(tx, customerOf.get(A)!, [{ fieldId: size.id, value }], seal, fit),
      );
    await put(' M ');
    expect(seen).toEqual([['select', ['S', 'M']]]);
    expect(await failure(put('XL'))).toBeInstanceOf(FieldValueInvalidError);
    const stored = await admin.query(
      'SELECT value FROM customer_field_values WHERE field_id = $1',
      [size.id],
    );
    expect(stored.rows).toEqual([{ value: 'M' }]);
  });
});
