import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  createTag,
  listTags,
  lockTags,
  listCustomers,
  loadCustomer,
  mergeTag,
  setCustomerTags,
  TAG_LIMIT,
  TagHiddenError,
  TagLimitError,
  TagNameTakenError,
  TagNotFoundError,
  updateTag,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The tags of a company (Tag 3a, N190) through RLS: one live tag per name whatever the case, at most TAG_LIMIT, a merge that loses no
// customer, and nothing deleted.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;
const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: A, workspaceIds: [] }, fn);
const make = (name: string) => inA((tx) => createTag(tx, { id: uuidv7(), name }));
const failure = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

/** `n` customers of A, with the tags `tagIds` (live) and `offTagIds` (switched off). */
async function customers(n: number, tagIds: string[] = [], offTagIds: string[] = []) {
  const ids = Array.from({ length: n }, () => uuidv7());
  for (const id of ids) {
    await admin.query('INSERT INTO customers (id, org_id) VALUES ($1, $2)', [id, A]);
    for (const [tag, off] of [...tagIds.map((t) => [t, false]), ...offTagIds.map((t) => [t, true])])
      await admin.query(
        'INSERT INTO customer_tags (id, org_id, customer_id, tag_id, deleted_at) VALUES ($1, $2, $3, $4, $5)',
        [uuidv7(), A, id, tag, off ? new Date() : null],
      );
  }
  return ids;
}
const liveTagsOf = async (customerId: string) =>
  (
    await admin.query<{ tag_id: string }>(
      'SELECT tag_id FROM customer_tags WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY tag_id',
      [customerId],
    )
  ).rows.map((r) => r.tag_id);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 3 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  // The seed tag of fixtures.ts is out of the way of these tests.
  await admin.query('UPDATE tags SET deleted_at = now() WHERE org_id = $1', [A]);
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('tag-store', () => {
  it('makes tags, lists them by name with their live customers, one live name whatever the case', async () => {
    const vip = await make('VIP');
    const [, gone] = await customers(2, [vip.id]);
    await admin.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [gone]);
    await make('bán lẻ');
    expect(await failure(make('vip'))).toBeInstanceOf(TagNameTakenError);
    const list = await inA(listTags);
    expect(list.map((t) => [t.name, t.customerCount, t.hidden])).toEqual([
      ['bán lẻ', 0, false],
      ['VIP', 1, false],
    ]);
    expect(await withTenant(pool, { orgId: B, workspaceIds: [] }, listTags)).toHaveLength(1);
  });

  it('renames and hides a tag locked before, and refuses a name taken', async () => {
    const [a, b] = [await make('Sỉ'), await make('Lẻ')];
    const changed = await inA(async (tx) => {
      await lockTags(tx, [a.id]);
      return updateTag(tx, a.id, { name: 'Bán sỉ', hidden: true });
    });
    expect(changed).toMatchObject({ name: 'Bán sỉ', hidden: true });
    expect(await inA((tx) => updateTag(tx, a.id, { hidden: false }))).toMatchObject({
      name: 'Bán sỉ',
      hidden: false,
    });
    expect(await inA((tx) => lockTags(tx, []))).toEqual([]);
    expect(await failure(inA((tx) => updateTag(tx, b.id, { name: 'BÁN SỈ' })))).toBeInstanceOf(
      TagNameTakenError,
    );
  });

  it(`stops at ${TAG_LIMIT} live tags, one maker at a time, deleted ones aside`, async () => {
    const live = (
      await admin.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM tags WHERE org_id = $1 AND deleted_at IS NULL',
        [A],
      )
    ).rows[0]!.n;
    const ids = Array.from({ length: TAG_LIMIT - 1 - live }, () => uuidv7());
    await admin.query(
      'INSERT INTO tags (id, org_id, name) SELECT id, $2, $3 || n FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, n)',
      [ids, A, 'Lô '],
    );
    await admin.query(
      `INSERT INTO tags (id, org_id, name, deleted_at) VALUES ($1, $2, 'Đã xóa', now())`,
      [uuidv7(), A],
    );
    const both = await Promise.allSettled([make('Cuối 1'), make('Cuối 2')]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = both.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(TagLimitError);
    await admin.query(`UPDATE tags SET deleted_at = now() WHERE org_id = $1 AND name LIKE 'Lô %'`, [
      A,
    ]);
  });

  it('merges a tag into another: every customer keeps one live link, the source ends and frees its name', async () => {
    const [from, into] = [await make('Nguồn'), await make('Đích')];
    const [onlyFrom] = await customers(1, [from.id]);
    const [bothLive] = await customers(1, [from.id, into.id]);
    const [intoOff] = await customers(1, [from.id], [into.id]);
    const [onlyInto] = await customers(1, [into.id]);
    const moved = await inA(async (tx) => {
      await lockTags(tx, [from.id, into.id]);
      return mergeTag(tx, from.id, into.id);
    });
    expect(moved).toBe(2);
    for (const c of [onlyFrom, bothLive, intoOff, onlyInto])
      expect(await liveTagsOf(c!)).toEqual([into.id]);
    const links = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM customer_tags WHERE tag_id = $1 AND customer_id = ANY($2)',
      [into.id, [onlyFrom, bothLive, intoOff, onlyInto]],
    );
    expect(links.rows[0]!.n).toBe(4);
    expect((await inA((tx) => lockTags(tx, [from.id, into.id]))).map((t) => t.id)).toEqual([
      into.id,
    ]);
    expect((await make('nguồn')).name).toBe('nguồn');
  });

  it("sets a customer's whole set of tags, keeps a hidden one it has, and reads and filters customers by tag", async () => {
    const [a, b, hidden] = [await make('Tag A'), await make('Tag B'), await make('Tag C ẩn')];
    const [c] = await customers(1, [hidden.id], [b.id]);
    const [other] = await customers(1);
    await admin.query('UPDATE tags SET hidden = true WHERE id = $1', [hidden.id]);
    const set = (ids: string[], customer = c!) => inA((tx) => setCustomerTags(tx, customer, ids));
    expect((await set([a.id, b.id, hidden.id]))!.map((t) => [t.name, t.hidden])).toEqual([
      ['Tag A', false],
      ['Tag B', false],
      ['Tag C ẩn', true],
    ]);
    expect(await failure(set([hidden.id], other))).toBeInstanceOf(TagHiddenError);
    expect(await failure(set([uuidv7()]))).toBeInstanceOf(TagNotFoundError);
    expect(await set([], uuidv7())).toBeNull();
    expect((await set([b.id]))!.map((t) => t.name)).toEqual(['Tag B']);
    const links = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM customer_tags WHERE customer_id = $1',
      [c],
    );
    expect(links.rows[0]!.n).toBe(3);
    expect((await inA((tx) => loadCustomer(tx, c!)))!.tags).toEqual([
      { id: b.id, name: 'Tag B', hidden: false },
    ]);
    const byTag = (tagId: string) =>
      inA(async (tx) => (await listCustomers(tx, { tagId, limit: 100 })).rows.map((r) => r.id));
    expect(await byTag(b.id)).toEqual([c]);
    expect(await byTag(hidden.id)).toEqual([]);
  });
});
