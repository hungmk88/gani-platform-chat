import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// bot_flows and bot_flow_versions (D1a1a, N176, Brief P13 and M05): RLS by organisation, a published version or a discarded draft
// never changes or goes away (BF001, for every role), a version is published with a time and a number, at most one draft per flow,
// and app_role deletes nothing (spec RLS M01 §2). Each case uses flows of its own, written as migration_role.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const workspaceOf = new Map<string, string>();
let admin: pg.Client;
let app: pg.Client;

const q = (text: string, params: unknown[] = []) => admin.query(text, params);
async function flow(org: string): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO bot_flows (id, org_id, workspace_id, name) VALUES ($1, $2, $3, 'Chào khách')`,
    [id, org, workspaceOf.get(org)],
  );
  return id;
}
async function version(org: string, flowId: string, status = 'draft', number?: number) {
  const id = uuidv7();
  const published = status === 'published';
  await q(
    `INSERT INTO bot_flow_versions (id, org_id, flow_id, status, version, published_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, org, flowId, status, published ? (number ?? 1) : null, published ? new Date() : null],
  );
  return id;
}
const inA = <T>(fn: () => Promise<T>) => asApp(app, A, [workspaceOf.get(A) ?? ''], fn);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const org of [A, B]) {
    seedUsers.set(org, await seedTenant(admin, org));
    const { rows } = await q('SELECT id FROM workspaces WHERE org_id = $1', [org]);
    workspaceOf.set(org, (rows[0] as { id: string }).id);
  }
});

afterAll(async () => {
  await app.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('bot_flows and bot_flow_versions', () => {
  it('keep each organisation to its own flows and versions (RLS O), and to workspaces of its own', async () => {
    const [mine, theirs] = [await flow(A), await flow(B)];
    await version(B, theirs);
    const seen = await inA(async () => ({
      flows: (await app.query<{ id: string }>('SELECT id FROM bot_flows')).rows.map((r) => r.id),
      versions: (await app.query<{ org_id: string }>('SELECT org_id FROM bot_flow_versions')).rows,
    }));
    expect(seen.flows).toContain(mine);
    expect(seen.flows).not.toContain(theirs);
    expect(seen.versions.every((v) => v.org_id === A)).toBe(true);
    // A version of B's flow under A's name: the pair (org_id, flow_id) does not exist.
    const insert = `INSERT INTO bot_flow_versions (id, org_id, flow_id) VALUES ($1, $2, $3)`;
    expect(await sqlState(inA(() => app.query(insert, [uuidv7(), A, theirs])))).toBe('23503');
    // A row of B written from a session of A: refused by the policy.
    expect(await sqlState(inA(() => app.query(insert, [uuidv7(), B, theirs])))).toBe('42501');
    const other = `INSERT INTO bot_flows (id, org_id, workspace_id, name) VALUES ($1, $2, $3, 'X')`;
    expect(await sqlState(q(other, [uuidv7(), A, workspaceOf.get(B)]))).toBe('23503');
  });

  it('refuse any change or deletion of a published version or a discarded draft, for every role (BF001)', async () => {
    const id = await flow(A);
    const published = await version(A, id, 'published', 1);
    const discarded = await version(A, id, 'discarded');
    const touch = `UPDATE bot_flow_versions SET updated_at = now() WHERE id = $1`;
    expect(await sqlState(inA(() => app.query(touch, [published])))).toBe('BF001');
    expect(await sqlState(inA(() => app.query(touch, [discarded])))).toBe('BF001');
    expect(await sqlState(q(touch, [published]))).toBe('BF001');
    expect(
      await sqlState(q(`UPDATE bot_flow_versions SET status = 'draft' WHERE id = $1`, [discarded])),
    ).toBe('BF001');
    expect(await sqlState(q('DELETE FROM bot_flow_versions WHERE id = $1', [published]))).toBe(
      'BF001',
    );
    expect(await sqlState(q('DELETE FROM bot_flow_versions WHERE id = $1', [discarded]))).toBe(
      'BF001',
    );
  });

  it('let a draft be saved, then published only with a time and a number, after which it is frozen', async () => {
    const id = await flow(A);
    const draft = await version(A, id);
    const set = (sql: string) =>
      sqlState(inA(() => app.query(`UPDATE bot_flow_versions SET ${sql} WHERE id = $1`, [draft])));
    expect(await set('updated_at = now()')).toBeUndefined();
    expect(await set(`status = 'published', version = 1`)).toBe('23514');
    expect(await set(`status = 'published', published_at = now()`)).toBe('23514');
    expect(await set(`published_at = now()`)).toBe('23514');
    // asApp rolls back: publish for real as the owner, then the draft is a published version.
    await q(
      `UPDATE bot_flow_versions SET status = 'published', version = 1, published_at = now() WHERE id = $1`,
      [draft],
    );
    expect(await set('updated_at = now()')).toBe('BF001');
  });

  it('hold one draft per flow and one version per number, any number of discarded drafts', async () => {
    const id = await flow(A);
    await version(A, id);
    await version(A, id, 'discarded');
    await version(A, id, 'discarded');
    await version(A, id, 'published', 1);
    expect(await sqlState(version(A, id))).toBe('23505');
    expect(await sqlState(version(A, id, 'published', 1))).toBe('23505');
    expect(await sqlState(version(A, id, 'published', 2))).toBeUndefined();
  });

  it('give app_role no DELETE, and no way to move a flow or a version to another key', async () => {
    const id = await flow(A);
    const draft = await version(A, id);
    expect(
      await sqlState(inA(() => app.query('DELETE FROM bot_flow_versions WHERE id = $1', [draft]))),
    ).toBe('42501');
    expect(await sqlState(inA(() => app.query('DELETE FROM bot_flows WHERE id = $1', [id])))).toBe(
      '42501',
    );
    const move = `UPDATE bot_flow_versions SET flow_id = $2 WHERE id = $1`;
    expect(await sqlState(inA(() => app.query(move, [draft, uuidv7()])))).toBe('42501');
    const rehome = `UPDATE bot_flows SET workspace_id = $2 WHERE id = $1`;
    expect(await sqlState(inA(() => app.query(rehome, [id, uuidv7()])))).toBe('42501');
  });
});
