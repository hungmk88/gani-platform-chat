import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, lostReasonsInForce, withTenant } from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The list of reasons to lose a lead in force (N200 answer 1), as app_role through RLS: the rows of the latest effective_from not in the
// future; a list set for later shows once it is due, never before.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const ids = { ws: '', ws2: '' };
let admin: pg.Client;
let pool: pg.Pool;
const PAST = new Date('2026-01-01T00:00:00Z');
const FUTURE = new Date(Date.now() + 86_400_000);
const inForce = (workspace: string, at?: Date, org = A) =>
  withTenant(pool, { orgId: org, workspaceIds: [workspace] }, (tx) =>
    lostReasonsInForce(tx, workspace, at),
  );
/** Writes a list as the operator's commands do (migration_role); `from` is SQL for its effective_from. */
const writeList = (workspace: string, from: string, names: string[]) =>
  admin.query(
    `INSERT INTO pipeline_lost_reasons (id, org_id, workspace_id, name, position, effective_from)
     SELECT ($4::uuid[])[i], $1, $2, ($3::text[])[i], i - 1, ${from} FROM generate_subscripts($3::text[], 1) AS i`,
    [A, workspace, names, names.map(() => uuidv7())],
  );

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  ids.ws = (await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [A]))
    .rows[0]?.id as string;
  ids.ws2 = uuidv7();
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')`,
    [ids.ws2, A],
  );
  // The seed list of fixtures.ts is out of the way of these tests.
  await admin.query('DELETE FROM pipeline_lost_reasons WHERE org_id = $1', [A]);
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('lostReasonsInForce', () => {
  it('reads the list of the latest effective_from not in the future, in order; a later list only from its due time', async () => {
    expect(await inForce(ids.ws)).toEqual([]);
    await writeList(ids.ws, `'${PAST.toISOString()}'`, ['Giá cao', 'Khác (chờ Q9)']);
    await writeList(ids.ws, `'${FUTURE.toISOString()}'`, ['Khác']);
    expect(await inForce(ids.ws)).toEqual(['Giá cao', 'Khác (chờ Q9)']);
    // At its very due time the later list is in force; a millisecond before, the one it follows.
    expect(await inForce(ids.ws, FUTURE)).toEqual(['Khác']);
    expect(await inForce(ids.ws, new Date(FUTURE.getTime() - 1))).toEqual([
      'Giá cao',
      'Khác (chờ Q9)',
    ]);
    expect(await inForce(ids.ws, new Date(PAST.getTime() - 1))).toEqual([]);
  });

  it('turns to a list set for later once the clock of the database reaches it', async () => {
    await writeList(ids.ws2, 'now()', ['Khác (chờ Q9)']);
    await writeList(ids.ws2, "now() + interval '1500 milliseconds'", ['Hết hàng']);
    expect(await inForce(ids.ws2)).toEqual(['Khác (chờ Q9)']);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(await inForce(ids.ws2)).toEqual(['Hết hàng']);
  });

  it('shows nothing of a workspace outside the session or of another organisation', async () => {
    const other = await withTenant(pool, { orgId: A, workspaceIds: [ids.ws2] }, (tx) =>
      lostReasonsInForce(tx, ids.ws),
    );
    expect(other).toEqual([]);
    expect(await inForce(ids.ws, undefined, B)).toEqual([]);
  });
});
