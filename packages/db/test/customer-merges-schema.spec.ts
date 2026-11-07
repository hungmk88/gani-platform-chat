import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The tables of the merge of customers (J3a, N204): what the database refuses on its own, before any store. RLS across organisations,
// no DELETE and the UPDATE columns of app_role are also checked by rls-all-tables.spec and grants.spec.
const [org, other] = [uuidv7(), uuidv7()];
const users: string[] = [];
let [a, b, c, foreign] = ['', '', '', ''];
let admin: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const o of [org, other]) users.push(await seedTenant(admin, o));
  [a, b, c, foreign] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  await admin.query(
    'INSERT INTO customers (id, org_id) VALUES ($1, $4), ($2, $4), ($3, $4), ($5, $6)',
    [a, b, c, org, foreign, other],
  );
});

afterAll(async () => {
  await app.end();
  for (const [i, o] of [org, other].entries()) await cleanupTenant(admin, o, users[i] as string);
  await admin.end();
});

const merge = (over: Record<string, unknown> = {}) => {
  const row: Record<string, unknown> = {
    id: uuidv7(),
    org_id: org,
    source_id: a,
    target_id: b,
    merged_by: users[0],
    ...over,
  };
  const cols = Object.keys(row);
  return sqlState(
    admin.query(
      `INSERT INTO customer_merges (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row),
    ),
  );
};
const merged = (id: string, into: string | null, at: string | null) =>
  sqlState(
    admin.query('UPDATE customers SET merged_into = $2, merged_at = $3 WHERE id = $1', [
      id,
      into,
      at,
    ]),
  );

describe('customers.merged_into', () => {
  it('points at another customer of the same organisation, exactly while it has a time of merge', async () => {
    expect(await merged(a, a, '2026-11-07T08:00:00Z')).toBe('23514');
    expect(await merged(a, b, null)).toBe('23514');
    expect(await merged(a, null, '2026-11-07T08:00:00Z')).toBe('23514');
    expect(await merged(a, foreign, '2026-11-07T08:00:00Z')).toBe('23503');
    expect(await merged(a, b, '2026-11-07T08:00:00Z')).toBeUndefined();
    expect(await merged(a, null, null)).toBeUndefined();
  });

  it('survives the soft delete of the target, and still keeps the target from a DELETE alone (NO ACTION)', async () => {
    const [source, target] = [uuidv7(), uuidv7()];
    await admin.query('INSERT INTO customers (id, org_id) VALUES ($1, $3), ($2, $3)', [
      source,
      target,
      org,
    ]);
    expect(await merged(source, target, '2026-11-07T08:00:00Z')).toBeUndefined();
    await admin.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [target]);
    const { rows } = await admin.query<{ merged_into: string }>(
      'SELECT merged_into FROM customers WHERE id = $1',
      [source],
    );
    expect(rows).toEqual([{ merged_into: target }]);
    expect(await sqlState(admin.query('DELETE FROM customers WHERE id = $1', [target]))).toBe(
      '23503',
    );
    // One statement may take a source and its target together (the test cleanup); the key is checked at its end.
    const both = admin.query('DELETE FROM customers WHERE id = ANY($1::uuid[])', [
      [target, source],
    ]);
    expect(await sqlState(both)).toBeUndefined();
  });
});

describe('customer_merges', () => {
  it('joins two different customers of the organisation, by a member of it', async () => {
    expect(await merge({ target_id: a })).toBe('23514');
    expect(await merge({ target_id: foreign })).toBe('23503');
    expect(await merge({ source_id: foreign })).toBe('23503');
    expect(await merge({ merged_by: users[1] })).toBe('23503');
  });

  it('names only the three fields a merge may fill, and is undone with who and when together', async () => {
    expect(await merge({ filled_fields: ['display_name', 'note'] })).toBe('23514');
    expect(await merge({ unmerged_at: '2026-11-07T09:00:00Z' })).toBe('23514');
    expect(await merge({ unmerged_by: users[0] })).toBe('23514');
    const undone = { unmerged_at: '2026-11-07T09:00:00Z' };
    expect(await merge({ ...undone, unmerged_by: users[1] })).toBe('23503');
  });

  it('holds at most one live merge per source; an undone one does not count', async () => {
    const at = '2026-11-07T09:00:00Z';
    expect(await merge({ source_id: c, unmerged_at: at, unmerged_by: users[0] })).toBeUndefined();
    expect(await merge({ source_id: c, filled_fields: ['email'] })).toBeUndefined();
    expect(await merge({ source_id: c, target_id: a })).toBe('23505');
  });
});

describe('customer_merge_moves', () => {
  it('names a row of one of the six tables a merge moves, once per merge', async () => {
    const id = uuidv7();
    expect(await merge({ id, source_id: b, target_id: a })).toBeUndefined();
    const move = (table: string, row = uuidv7(), mergeId = id) =>
      sqlState(
        admin.query(
          'INSERT INTO customer_merge_moves (id, org_id, merge_id, table_name, row_id) VALUES ($1, $2, $3, $4, $5)',
          [uuidv7(), org, mergeId, table, row],
        ),
      );
    const row = uuidv7();
    expect(await move('tickets', row)).toBeUndefined();
    expect(await move('tickets', row)).toBe('23505');
    expect(await move('messages')).toBe('23514');
    expect(await move('leads', uuidv7(), uuidv7())).toBe('23503');
  });
});

describe('app_role', () => {
  it('writes the log of its organisation only, and never rewrites a moved row', async () => {
    const insertOther = asApp(app, org, [], () =>
      app.query(
        `INSERT INTO customer_merges (id, org_id, source_id, target_id, merged_by) VALUES ($1, $2, $3, $4, $5)`,
        [uuidv7(), other, foreign, a, users[1]],
      ),
    );
    expect(await sqlState(insertOther)).toBe('42501');
    const rewrite = asApp(app, org, [], () =>
      app.query('UPDATE customer_merge_moves SET row_id = row_id'),
    );
    expect(await sqlState(rewrite)).toBe('42501');
    const relink = asApp(app, org, [], () =>
      app.query('UPDATE customer_merges SET target_id = target_id'),
    );
    expect(await sqlState(relink)).toBe('42501');
  });
});
