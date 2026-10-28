import { readFileSync } from 'node:fs';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The names of customers in NFC (202611010900, N165): the CHECK, and what the migration does to rows written before it. The migration is
// run again inside a transaction that drops the CHECK first and is rolled back: nothing of it persists.
const MIGRATION = readFileSync(
  new URL('../migrations/202611010900_add_customers_display_name_nfc_check.sql', import.meta.url),
  'utf8',
);
const ORG = uuidv7();
const admin = new pg.Client({ connectionString: url('migration') });
let user = '';
const insert = (client: pg.Client, name: string | null, id = uuidv7()) =>
  client.query(
    `INSERT INTO customers (id, org_id, display_name, updated_at) VALUES ($1, $2, $3, '2026-01-01T00:00:00Z')`,
    [id, ORG, name],
  );

beforeAll(async () => {
  await admin.connect();
  user = await seedTenant(admin, ORG);
});

afterAll(async () => {
  await cleanupTenant(admin, ORG, user);
  await admin.end();
});

describe('customers_display_name_nfc_check', () => {
  it('refuses a name in NFD, takes one in NFC and no name at all', async () => {
    expect(await sqlState(insert(admin, 'Hoà Nguyễn'.normalize('NFD')))).toBe('23514');
    expect(await sqlState(insert(admin, 'Hoà Nguyễn'.normalize('NFC')))).toBeUndefined();
    expect(await sqlState(insert(admin, null))).toBeUndefined();
  });
});

describe('202611010900 on rows written before it', () => {
  it('turns every NFD name into NFC, touches no NFC row, and leaves updated_at as it was', async () => {
    const client = new pg.Client({ connectionString: url('migration') });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE customers DROP CONSTRAINT customers_display_name_nfc_check');
      const [nfd, nfc] = [[] as string[], [] as string[]];
      for (let n = 0; n < 50; n++) {
        nfd.push(uuidv7());
        nfc.push(uuidv7());
        await insert(client, `Nguyễn Thị Hoà ${n}`.normalize('NFD'), nfd.at(-1));
        await insert(client, `Trần Thuỷ ${n}`.normalize('NFC'), nfc.at(-1));
      }
      type Row = { id: string; name: string; ctid: string; updated: string };
      const read = async () =>
        new Map(
          (
            await client.query<Row>(
              `SELECT id, display_name AS name, ctid::text AS ctid, updated_at::text AS updated FROM customers WHERE id = ANY($1::uuid[])`,
              [[...nfd, ...nfc]],
            )
          ).rows.map((r) => [r.id, r]),
        );
      const before = await read();
      await client.query(MIGRATION);
      const after = await read();
      expect(after.size).toBe(100);
      for (const r of after.values()) expect(r.name).toBe(r.name.normalize('NFC'));
      // A row the UPDATE wrote gets a new version (ctid); the WHERE leaves the NFC rows alone.
      for (const id of nfd) expect(after.get(id)?.ctid).not.toBe(before.get(id)?.ctid);
      for (const id of nfc) expect(after.get(id)?.ctid).toBe(before.get(id)?.ctid);
      for (const r of after.values()) expect(r.updated).toBe(before.get(r.id)?.updated);
      // The CHECK is back once the migration ran.
      expect(await sqlState(insert(client, 'Hoà'.normalize('NFD')))).toBe('23514');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
