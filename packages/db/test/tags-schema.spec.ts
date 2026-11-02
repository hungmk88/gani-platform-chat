import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The tables of the tags (Tag 2a-i, T-4/U47, N190): what the database refuses on its own, before any store. Cross-organisation reads and
// "no DELETE" (case 11) are in rls-all-tables.spec, the UPDATE columns of app_role in grants.spec.
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

/** A tag of `org` named `name` (as migration_role, or `client`); resolves to its id, or throws with the SQLSTATE. */
async function tag(name: string, over: Record<string, string> = {}, client = admin) {
  const id = uuidv7();
  await client.query('INSERT INTO tags (id, org_id, name, deleted_at) VALUES ($1, $2, $3, $4)', [
    id,
    over['org_id'] ?? org,
    name,
    over['deleted_at'] ?? null,
  ]);
  return id;
}
const refused = (p: Promise<unknown>) => sqlState(p);

describe('tags', () => {
  it('takes a trimmed name of 1 to 50 characters in NFC, and nothing else', async () => {
    expect(await refused(tag('Khách sỉ'))).toBeUndefined();
    expect(await refused(tag('x'.repeat(50)))).toBeUndefined();
    for (const bad of ['', ' VIP', 'VIP ', 'x'.repeat(51), 'Khách'])
      expect(await refused(tag(bad)), JSON.stringify(bad)).toBe('23514');
  });

  it('has one live tag per name in the company whatever the case, and frees the name of a deleted one', async () => {
    await tag('Đại lý');
    expect(await refused(tag('ĐẠI LÝ'))).toBe('23505');
    expect(await refused(tag('Đại lý', { org_id: other }))).toBeUndefined();
    await tag('Cũ', { deleted_at: new Date().toISOString() });
    expect(await refused(tag('cũ'))).toBeUndefined();
  });
});

describe('customer_tags', () => {
  const link = (customerId: string, tagId: string) =>
    admin.query(
      'INSERT INTO customer_tags (id, org_id, customer_id, tag_id) VALUES ($1, $2, $3, $4)',
      [uuidv7(), org, customerId, tagId],
    );

  it('keeps one row per customer and tag, live or not, and never points into another organisation', async () => {
    const t = await tag('Một dòng');
    await link(customer, t);
    await admin.query(
      'UPDATE customer_tags SET deleted_at = now() WHERE customer_id = $1 AND tag_id = $2',
      [customer, t],
    );
    // Tagging again turns the same row back on: a second row is refused even while the first is deleted.
    expect(await refused(link(customer, t))).toBe('23505');
    expect(await refused(link(otherCustomer, t))).toBe('23503');
    const theirs = await tag('Của B', { org_id: other });
    expect(await refused(link(customer, theirs))).toBe('23503');
  });

  it('lets app_role only add a tag and turn it off or on, never change what a row links nor delete it', async () => {
    const t = await tag('Quyền');
    const write = (sql: string, params: unknown[] = []) =>
      asApp(app, org, [], () => refused(app.query(sql, params)));
    expect(
      await write(
        'INSERT INTO customer_tags (id, org_id, customer_id, tag_id) VALUES ($1, $2, $3, $4)',
        [uuidv7(), org, customer, t],
      ),
    ).toBeUndefined();
    expect(await write('UPDATE customer_tags SET deleted_at = now() WHERE tag_id = $1', [t])).toBe(
      undefined,
    );
    expect(await write('UPDATE customer_tags SET tag_id = tag_id')).toBe('42501');
    expect(await write('UPDATE customer_tags SET customer_id = customer_id')).toBe('42501');
    expect(await write('UPDATE tags SET org_id = org_id')).toBe('42501');
    expect(await write('DELETE FROM customer_tags WHERE tag_id = $1', [t])).toBe('42501');
    expect(await write('DELETE FROM tags WHERE id = $1', [t])).toBe('42501');
  });
});
