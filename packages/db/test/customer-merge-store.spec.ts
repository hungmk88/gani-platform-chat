import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDbPool,
  CustomerMergeNotFoundError,
  CustomerNotMergedError,
  listCustomerMerges,
  listCustomers,
  liveWorkspaceIds,
  loadCustomer,
  loadCustomerForUnmerge,
  loadCustomerMerge,
  mergeCustomers,
  MergeTargetMergedError,
  unmergeCustomer,
  withTenant,
  type TenantTx,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The merge of duplicate customers and its undoing (J3b, N204) as app_role through RLS, with every live workspace of the organisation
// in the transaction: what moves, what stays, what the log keeps, the audit, and the refusals (CEO 07/11/2026).
const [org, other] = [uuidv7(), uuidv7()];
const users: string[] = [];
let [ws, ws2, stage, stage2, tagX, tagY, field] = ['', '', '', '', '', '', ''];
let admin: pg.Client;
let pool: pg.Pool;

const all = <T>(fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(pool, { orgId: org, workspaceIds: [ws, ws2] }, fn);
const merge = (sourceId: string, targetId: string) =>
  all((tx) => mergeCustomers(tx, { sourceId, targetId, actorUserId: users[0]!, newId: uuidv7 }));
const unmerge = (sourceId: string) =>
  all((tx) => unmergeCustomer(tx, { sourceId, actorUserId: users[0]!, newId: uuidv7 }));
const q = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
  (await admin.query<T>(sql, params)).rows;
const ownerOf = async (table: string, id: string) =>
  (await q<{ customer_id: string }>(`SELECT customer_id FROM ${table} WHERE id = $1`, [id]))[0]
    ?.customer_id;

/** A customer with one row of each kind a merge moves; `ws2` holds its ticket and lead, outside the first workspace. */
async function customer(fields: { name?: string; phone?: string; email?: string } = {}) {
  const id = uuidv7();
  const row = { conversation: uuidv7(), identity: uuidv7(), ticket: uuidv7(), lead: uuidv7() };
  await admin.query(
    'INSERT INTO customers (id, org_id, display_name, phone_e164, email) VALUES ($1, $2, $3, $4, $5)',
    [id, org, fields.name ?? null, fields.phone ?? null, fields.email ?? null],
  );
  await admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state, customer_id) VALUES ($1, $2, $3, 'BOT_ACTIVE', $4)`,
    [row.conversation, org, ws, id],
  );
  const channel = (
    await q<{ id: string }>('SELECT id FROM channel_accounts WHERE org_id = $1', [org])
  )[0]!.id;
  await admin.query(
    `INSERT INTO customer_identities (id, org_id, customer_id, identity_type, channel_account_id, external_id) VALUES ($1, $2, $3, 'zalo_uid', $4, $5)`,
    [row.identity, org, id, channel, `zu-${id}`],
  );
  await admin.query(
    `INSERT INTO tickets (id, org_id, workspace_id, title, customer_id, created_by) VALUES ($1, $2, $3, 'T', $4, $5)`,
    [row.ticket, org, ws2, id, users[0]],
  );
  await admin.query(
    `INSERT INTO leads (id, org_id, workspace_id, title, customer_id, stage_id, created_by) VALUES ($1, $2, $3, 'L', $4, $5, $6)`,
    [row.lead, org, ws2, id, stage2, users[0]],
  );
  return { id, ...row };
}
const tag = (customerId: string, tagId: string) =>
  admin.query(
    'INSERT INTO customer_tags (id, org_id, customer_id, tag_id) VALUES ($1, $2, $3, $4)',
    [uuidv7(), org, customerId, tagId],
  );
const value = async (customerId: string, v: string) =>
  (
    await admin.query<{ id: string }>(
      'INSERT INTO customer_field_values (id, org_id, customer_id, field_id, value) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [uuidv7(), org, customerId, field, JSON.stringify(v)],
    )
  ).rows[0]!.id;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 4 });
  for (const o of [org, other]) users.push(await seedTenant(admin, o));
  ws = (await q<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [org]))[0]!.id;
  stage = (await q<{ id: string }>('SELECT id FROM pipeline_stages WHERE org_id = $1', [org]))[0]!
    .id;
  [ws2, stage2, tagX, tagY, field] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'w2', 'W2', 'service')`,
    [ws2, org],
  );
  await admin.query(
    `INSERT INTO pipeline_stages (id, org_id, workspace_id, name, position) VALUES ($1, $2, $3, 'B', 0)`,
    [stage2, org, ws2],
  );
  await admin.query(`INSERT INTO tags (id, org_id, name) VALUES ($1, $3, 'X'), ($2, $3, 'Y')`, [
    tagX,
    tagY,
    org,
  ]);
  await admin.query(
    `INSERT INTO customer_field_defs (id, org_id, name, type) VALUES ($1, $2, 'Hạng', 'text')`,
    [field, org],
  );
  void stage;
});

afterAll(async () => {
  await pool.end();
  for (const [i, o] of [org, other].entries()) await cleanupTenant(admin, o, users[i] as string);
  await admin.end();
});

let s: Awaited<ReturnType<typeof customer>>;
let t: Awaited<ReturnType<typeof customer>>;
beforeEach(async () => {
  s = await customer({ name: 'An', phone: '+84912345678' });
  t = await customer({ email: 'an@example.com' });
});

describe('mergeCustomers', () => {
  it('moves every row of the source, in every workspace, fills only the empty fields of the target, and hides the source', async () => {
    await tag(s.id, tagX);
    await tag(s.id, tagY);
    await tag(t.id, tagY);
    const kept = await value(s.id, 'Vàng');
    await value(t.id, 'Bạc');
    // The target has a name of its own: the merge keeps it, and fills only the phone it lacks.
    await admin.query(`UPDATE customers SET display_name = 'Bình' WHERE id = $1`, [t.id]);
    const { mergeId } = await merge(s.id, t.id);
    for (const [table, id] of [
      ['conversations', s.conversation],
      ['customer_identities', s.identity],
      ['tickets', s.ticket],
      ['leads', s.lead],
    ] as const)
      expect(await ownerOf(table, id), table).toBe(t.id);
    // The target keeps its own tag Y and its own value; the source keeps its copies of them.
    const tags = await q<{ customer_id: string; tag_id: string }>(
      'SELECT customer_id, tag_id FROM customer_tags WHERE customer_id = ANY($1::uuid[]) ORDER BY customer_id, tag_id',
      [[s.id, t.id]],
    );
    expect(tags.filter((r) => r.customer_id === s.id).map((r) => r.tag_id)).toEqual([tagY]);
    expect(await ownerOf('customer_field_values', kept)).toBe(s.id);
    const [target] = await q<{ display_name: string; phone_e164: string; email: string }>(
      'SELECT display_name, phone_e164, email FROM customers WHERE id = $1',
      [t.id],
    );
    expect(target).toEqual({
      display_name: 'Bình',
      phone_e164: '+84912345678',
      email: 'an@example.com',
    });
    const [log] = await q<{ filled_fields: string[]; moves: string }>(
      `SELECT filled_fields, (SELECT count(*) FROM customer_merge_moves WHERE merge_id = $1)::text AS moves FROM customer_merges WHERE id = $1`,
      [mergeId],
    );
    expect(log).toEqual({ filled_fields: ['phone_e164'], moves: '5' });
    const audit = await q<{ detail: Record<string, string> }>(
      `SELECT detail FROM audit_logs WHERE org_id = $1 AND action = 'customer.merged' AND target_id = $2`,
      [org, t.id],
    );
    expect(audit).toEqual([{ detail: { mergeId, sourceId: s.id, targetId: t.id } }]);
    expect(await all((tx) => loadCustomer(tx, s.id))).toBeNull();
    const listed = await all((tx) => listCustomers(tx, { limit: 100 }));
    expect(listed.rows.map((r) => r.id)).toContain(t.id);
    expect(listed.rows.map((r) => r.id)).not.toContain(s.id);
  });

  it('refuses a soft-deleted target with 404 and writes nothing, not even the log', async () => {
    await admin.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [t.id]);
    await expect(merge(s.id, t.id)).rejects.toBeInstanceOf(CustomerMergeNotFoundError);
    expect(await ownerOf('tickets', s.ticket)).toBe(s.id);
    expect(await q('SELECT 1 FROM customer_merges WHERE source_id = $1', [s.id])).toEqual([]);
  });

  it('refuses the same customer, a merged one, and one of another organisation', async () => {
    await expect(merge(s.id, s.id)).rejects.toBeInstanceOf(CustomerMergeNotFoundError);
    const foreign = (
      await q<{ id: string }>(
        'SELECT id FROM customers WHERE org_id = $1 AND merged_into IS NULL',
        [other],
      )
    )[0]!.id;
    await expect(merge(s.id, foreign)).rejects.toBeInstanceOf(CustomerMergeNotFoundError);
    await merge(s.id, t.id);
    const third = await customer();
    await expect(merge(s.id, third.id)).rejects.toBeInstanceOf(CustomerMergeNotFoundError);
    await expect(merge(third.id, s.id)).rejects.toBeInstanceOf(CustomerMergeNotFoundError);
  });

  it('lets two merges of the same pair, crossing each other, end with one merge and no deadlock', async () => {
    const results = await Promise.allSettled([merge(s.id, t.id), merge(t.id, s.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(CustomerMergeNotFoundError);
  });
});

describe('unmergeCustomer', () => {
  it('gives back exactly the moved rows and the filled fields; what came after the merge stays with the target', async () => {
    await merge(s.id, t.id);
    // A phone changed on the target after the merge is the target's own now: the unmerge leaves it.
    await admin.query(`UPDATE customers SET phone_e164 = '+84900000000' WHERE id = $1`, [t.id]);
    const later = uuidv7();
    await admin.query(
      `INSERT INTO tickets (id, org_id, workspace_id, title, customer_id, created_by) VALUES ($1, $2, $3, 'Sau', $4, $5)`,
      [later, org, ws, t.id, users[0]],
    );
    await unmerge(s.id);
    for (const [table, id] of [
      ['conversations', s.conversation],
      ['customer_identities', s.identity],
      ['tickets', s.ticket],
      ['leads', s.lead],
    ] as const)
      expect(await ownerOf(table, id), table).toBe(s.id);
    expect(await ownerOf('tickets', later)).toBe(t.id);
    expect(await ownerOf('tickets', t.ticket)).toBe(t.id);
    const [target] = await q(
      'SELECT display_name, phone_e164, email FROM customers WHERE id = $1',
      [t.id],
    );
    expect(target).toEqual({
      display_name: null,
      phone_e164: '+84900000000',
      email: 'an@example.com',
    });
    const [source] = await q('SELECT merged_into, merged_at FROM customers WHERE id = $1', [s.id]);
    expect(source).toEqual({ merged_into: null, merged_at: null });
    const audit = await q(
      `SELECT 1 FROM audit_logs WHERE org_id = $1 AND action = 'customer.unmerged' AND target_id = $2`,
      [org, t.id],
    );
    expect(audit).toHaveLength(1);
  });

  it('works when the target was soft deleted since (CEO 07/11): the rows go back to the source', async () => {
    await merge(s.id, t.id);
    await admin.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [t.id]);
    await unmerge(s.id);
    expect(await ownerOf('tickets', s.ticket)).toBe(s.id);
    const [source] = await q('SELECT merged_into FROM customers WHERE id = $1', [s.id]);
    expect(source).toEqual({ merged_into: null });
  });

  it('allows the same pair to merge again after an unmerge: two merges in the log, one live', async () => {
    await merge(s.id, t.id);
    await unmerge(s.id);
    await merge(s.id, t.id);
    const rows = await q<{ live: boolean }>(
      'SELECT unmerged_at IS NULL AS live FROM customer_merges WHERE source_id = $1 ORDER BY merged_at',
      [s.id],
    );
    expect(rows).toEqual([{ live: false }, { live: true }]);
  });

  it('refuses a customer not merged, one unknown, and one whose target was merged in turn', async () => {
    await expect(unmerge(s.id)).rejects.toBeInstanceOf(CustomerNotMergedError);
    await expect(unmerge(uuidv7())).rejects.toBeInstanceOf(CustomerMergeNotFoundError);
    const third = await customer();
    await merge(s.id, t.id);
    await merge(t.id, third.id);
    await expect(unmerge(s.id)).rejects.toBeInstanceOf(MergeTargetMergedError);
    await unmerge(t.id);
    await unmerge(s.id);
    expect(await ownerOf('tickets', s.ticket)).toBe(s.id);
  });
});

describe('the reads of the merge API (J3c, N206)', () => {
  it('names every live workspace, never a soft deleted one', async () => {
    const gone = uuidv7();
    await admin.query(
      `INSERT INTO workspaces (id, org_id, slug, name, template, deleted_at) VALUES ($1, $2, 'gone', 'G', 'service', now())`,
      [gone, org],
    );
    const ids = await withTenant(pool, { orgId: org, workspaceIds: [ws] }, liveWorkspaceIds);
    expect(ids).toEqual([ws, ws2].sort());
    await admin.query('DELETE FROM workspaces WHERE id = $1', [gone]);
  });

  it('reads one merge and the merges into a target, newest first, with who merged and the source name', async () => {
    const { mergeId: first } = await merge(s.id, t.id);
    await unmerge(s.id);
    const { mergeId: second } = await merge(s.id, t.id);
    const { name } = (
      await q<{ name: string | null }>(
        `SELECT nullif(btrim(display_name), '') AS name FROM users WHERE id = $1`,
        [users[0]],
      )
    )[0]!;
    const by = { id: users[0], name };
    expect(await all((tx) => loadCustomerMerge(tx, second))).toEqual({
      id: second,
      sourceId: s.id,
      targetId: t.id,
      mergedBy: by,
      mergedAt: expect.any(Date) as Date,
      unmergedAt: null,
    });
    expect(await all((tx) => loadCustomerMerge(tx, uuidv7()))).toBeNull();
    const list = await all((tx) => listCustomerMerges(tx, t.id));
    expect(list.map((r) => [r.id, r.unmergedAt === null, r.sourceName, r.mergedBy])).toEqual([
      [second, true, 'An', by],
      [first, false, 'An', by],
    ]);
  });

  it('reads a soft deleted customer for the answer of an unmerge only, and says it is deleted', async () => {
    await admin.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [t.id]);
    expect(await all((tx) => loadCustomer(tx, t.id))).toBeNull();
    const read = await all((tx) => loadCustomerForUnmerge(tx, t.id));
    expect(read).toMatchObject({ deleted: true, customer: { id: t.id, email: 'an@example.com' } });
    expect(Object.keys(read!.customer)).not.toContain('deleted');
    expect(await all((tx) => loadCustomerForUnmerge(tx, s.id))).toMatchObject({ deleted: false });
    expect(await all((tx) => loadCustomerForUnmerge(tx, uuidv7()))).toBeNull();
  });
});
