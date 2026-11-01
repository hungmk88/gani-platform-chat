import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, setConversationPriority, withTenant } from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The priority of a conversation that waits for a person (U78, 202611061000): normal by default, set only to normal, high or urgent,
// and only on a conversation the tenant sees.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const workspaceOf = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;

const as = <T>(org: string, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: org, workspaceIds: [workspaceOf.get(org)!] }, fn);
async function conversation(org: string): Promise<string> {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state) VALUES ($1, $2, $3, 'BOT_ACTIVE')`,
    [id, org, workspaceOf.get(org)],
  );
  return id;
}
const priorityOf = async (id: string) =>
  (
    await admin.query<{ priority: string }>('SELECT priority FROM conversations WHERE id = $1', [
      id,
    ])
  ).rows[0]?.priority;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) {
    seedUsers.set(org, await seedTenant(admin, org));
    const { rows } = await admin.query<{ id: string }>(
      'SELECT id FROM workspaces WHERE org_id = $1',
      [org],
    );
    workspaceOf.set(org, rows[0]!.id);
  }
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('setConversationPriority', () => {
  it('is normal by default and set to high or urgent on a conversation the tenant sees, never another organisation’s', async () => {
    const [mine, theirs] = [await conversation(A), await conversation(B)];
    expect(await priorityOf(mine)).toBe('normal');
    expect(await as(A, (tx) => setConversationPriority(tx, mine, 'urgent'))).toBe(true);
    expect(await priorityOf(mine)).toBe('urgent');
    expect(await as(A, (tx) => setConversationPriority(tx, theirs, 'high'))).toBe(false);
    expect(await priorityOf(theirs)).toBe('normal');
  });

  it('refuses a priority outside normal, high and urgent (CHECK)', async () => {
    const id = await conversation(A);
    await expect(
      admin.query("UPDATE conversations SET priority = 'asap' WHERE id = $1", [id]),
    ).rejects.toMatchObject({
      code: '23514',
    });
  });
});
