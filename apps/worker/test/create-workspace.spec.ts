import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { uuidv7 } from '@gani/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPool, type Pool } from './db.js';
import { requireEnv } from './harness.js';

// `tenant:create-workspace` (A2, N158) as the pipeline runs it: the BUILT script and PostgreSQL as migration_role. Org: an active
// owner, an active admin, a manager and a suspended admin; a deleted workspace whose slug stays taken.
const SCRIPT = fileURLToPath(new URL('../scripts/tenant.mjs', import.meta.url));
const [OPERATOR, ORG] = [uuidv7(), uuidv7()];
const ORG_SLUG = `t-${ORG}`;
const people = { owner: uuidv7(), admin: uuidv7(), manager: uuidv7(), suspended: uuidv7() };
let admin: Pool;

/** Runs the command; resolves with its exit code and the one JSON line it printed. */
function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; line: Record<string, unknown> }>((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, 'create-workspace', ...args], {
      env: {
        PATH: process.env['PATH'] ?? '',
        APP_ENV: 'test',
        DATABASE_URL_MIGRATION: requireEnv('DATABASE_URL_MIGRATION'),
        ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.on('exit', (code) => {
      const last = out.trim().split('\n').at(-1) ?? '{}';
      let line: Record<string, unknown>;
      try {
        line = JSON.parse(last) as Record<string, unknown>;
      } catch {
        line = { unparsed: last };
      }
      resolve({ code, line });
    });
  });
}
const args = (slug: string, over: Record<string, string> = {}) =>
  Object.entries({
    org: ORG_SLUG,
    name: 'Bán sỉ',
    slug,
    template: 'b2b',
    operator: `${OPERATOR}@example.test`,
    ...over,
  }).flatMap(([key, value]) => [`--${key}`, value]);

// prettier-ignore
beforeAll(async () => {
  admin = adminPool();
  await admin.query(`INSERT INTO users (id, email, status, email_verified_at, is_platform_operator) VALUES ($1, $2, 'active', now(), true)`, [OPERATOR, `${OPERATOR}@example.test`]);
  await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [ORG, ORG_SLUG, 'T']);
  for (const [key, id] of Object.entries(people)) {
    await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [id, `${id}@example.test`]);
    const [role, status] = key === 'suspended' ? ['admin', 'suspended'] : [key, 'active'];
    await admin.query('INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), ORG, id, role, status]);
  }
  await admin.query(`INSERT INTO workspaces (id, org_id, slug, name, template, deleted_at) VALUES ($1, $2, 'old', 'Cũ', 'service', now())`, [uuidv7(), ORG]);
});

afterAll(async () => {
  for (const table of [
    'platform_access_logs',
    'audit_logs',
    'workspace_members',
    'workspaces',
    'org_members',
  ])
    await admin.query(`DELETE FROM ${table} WHERE org_id = $1`, [ORG]).catch(() => undefined);
  await admin.query('DELETE FROM organizations WHERE id = $1', [ORG]).catch(() => undefined);
  await admin
    .query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[OPERATOR, ...Object.values(people)]])
    .catch(() => undefined);
  await admin.end();
});

describe('tenant:create-workspace', () => {
  it("makes the workspace with the org's active Owners and Admins as members, audits it, and is refused the second time", async () => {
    const first = await run(args('b2b', { timezone: 'Asia/Bangkok' }));
    expect(first).toMatchObject({
      code: 0,
      line: { event: 'workspace_created', orgId: ORG, members: 2 },
    });
    const id = String(first.line['workspaceId']);
    const row = await admin.query(
      'SELECT org_id, slug, name, template, timezone, default_max_concurrent, created_by FROM workspaces WHERE id = $1',
      [id],
    );
    expect(row.rows).toEqual([
      {
        org_id: ORG,
        slug: 'b2b',
        name: 'Bán sỉ',
        template: 'b2b_sales',
        timezone: 'Asia/Bangkok',
        default_max_concurrent: 5,
        created_by: null,
      },
    ]);
    const members = await admin.query<{ user_id: string }>(
      'SELECT user_id FROM workspace_members WHERE workspace_id = $1 ORDER BY user_id',
      [id],
    );
    expect(members.rows.map((m) => m.user_id)).toEqual([people.owner, people.admin].sort());
    const audit = await admin.query(
      'SELECT action, actor_user_id, target_id, detail FROM audit_logs WHERE org_id = $1',
      [ORG],
    );
    expect(audit.rows).toEqual([
      {
        action: 'workspace.created',
        actor_user_id: OPERATOR,
        target_id: id,
        detail: { slug: 'b2b', template: 'b2b_sales', via: 'tenant:create-workspace' },
      },
    ]);
    const access = await admin.query(
      'SELECT operator_user_id, reason FROM platform_access_logs WHERE org_id = $1',
      [ORG],
    );
    expect(access.rows).toEqual([
      { operator_user_id: OPERATOR, reason: 'tenant:create-workspace' },
    ]);

    const second = await run(args('b2b', { name: 'Khác' }));
    expect([second.code, second.line['reason']]).toEqual([1, 'slug_taken']);
  });

  it('refuses a deleted slug, an unknown org, someone who is not an operator and no APP_ENV, making nothing', async () => {
    const answers = [
      await run(args('old')),
      await run(args('new-one', { org: 'no-such-org' })),
      await run(args('new-one', { operator: 'nobody@example.test' })),
      await run(args('new-one'), { APP_ENV: '' }),
    ];
    expect(answers.map((a) => [a.code, a.line['reason']])).toEqual([
      [1, 'slug_taken'],
      [1, 'org_unknown'],
      [1, 'operator_unknown'],
      [1, 'app_env_missing'],
    ]);
    const made = await admin.query(
      "SELECT count(*)::int AS n FROM workspaces WHERE org_id = $1 AND slug = 'new-one'",
      [ORG],
    );
    expect(made.rows).toEqual([{ n: 0 }]);
  });
});
