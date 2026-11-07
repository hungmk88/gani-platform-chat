import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, listMergeSuggestions, withTenant } from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The suggestions of a merge (J3d, contract J3-0) as app_role through RLS: the same phone or the same email exactly, never a part of
// one; not the customer itself, not a merged or deleted one, not another organisation's; at most 20, newest first.
const [org, other] = [uuidv7(), uuidv7()];
const users: string[] = [];
let admin: pg.Client;
let pool: pg.Pool;

const suggest = (id: string) =>
  withTenant(pool, { orgId: org, workspaceIds: [] }, (tx) => listMergeSuggestions(tx, id));
async function customer(o: string, phone: string | null, email: string | null) {
  const id = uuidv7();
  await admin.query(
    'INSERT INTO customers (id, org_id, phone_e164, email) VALUES ($1, $2, $3, $4)',
    [id, o, phone, email],
  );
  return id;
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const o of [org, other]) users.push(await seedTenant(admin, o));
});

afterAll(async () => {
  await pool.end();
  for (const [i, o] of [org, other].entries()) await cleanupTenant(admin, o, users[i] as string);
  await admin.end();
});

describe('listMergeSuggestions', () => {
  it('suggests the same phone, the same email, or both, newest first, never a part, a merged, deleted or foreign one', async () => {
    const self = await customer(org, '+84911111111', 'an@example.test');
    const byPhone = await customer(org, '+84911111111', null);
    const byEmail = await customer(org, null, 'an@example.test');
    const byBoth = await customer(org, '+84911111111', 'an@example.test');
    await customer(org, '+8491111111', 'an@example.tes'); // a part of each: never
    const merged = await customer(org, '+84911111111', null);
    await admin.query('UPDATE customers SET merged_into = $1, merged_at = now() WHERE id = $2', [
      self,
      merged,
    ]);
    const deleted = await customer(org, '+84911111111', null);
    await admin.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [deleted]);
    await customer(other, '+84911111111', 'an@example.test');
    const rows = await suggest(self);
    expect(rows?.map((r) => [r.customer.id, r.reasons])).toEqual([
      [byBoth, ['phone', 'email']],
      [byEmail, ['email']],
      [byPhone, ['phone']],
    ]);
  });

  it('gives at most 20, none without a phone or an email, and null for a customer not live', async () => {
    const self = await customer(org, '+84922222222', null);
    const twins: string[] = [];
    for (let i = 0; i < 21; i++) twins.push(await customer(org, '+84922222222', null));
    expect((await suggest(self))?.map((r) => r.customer.id)).toEqual(twins.reverse().slice(0, 20));
    expect(await suggest(await customer(org, null, null))).toEqual([]);
    expect(await suggest(uuidv7())).toBeNull();
    expect(await suggest(await customer(other, '+84922222222', null))).toBeNull();
  });
});
