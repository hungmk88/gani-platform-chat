import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { uuidv7 } from '@gani/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPool, type Pool } from './db.js';
import { requireEnv } from './harness.js';

// `tenant:create-pipeline` (N200 answer 3) as the pipeline runs it: the BUILT script and PostgreSQL as migration_role. Org: a workspace
// made before the pipeline existed (nothing), one whose people made a step of their own (no reason yet), and a deleted one.
const SCRIPT = fileURLToPath(new URL('../scripts/tenant.mjs', import.meta.url));
const [OPERATOR, ORG] = [uuidv7(), uuidv7()];
const ORG_SLUG = `t-${ORG}`;
const ws = { bare: uuidv7(), own: uuidv7(), deleted: uuidv7() };
let admin: Pool;

/** Runs the command; resolves with its exit code and the one JSON line it printed. */
function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; line: Record<string, unknown> }>((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, 'create-pipeline', ...args], {
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
const args = (over: string[] = ['--all']) => [
  '--org',
  ORG_SLUG,
  '--operator',
  `${OPERATOR}@example.test`,
  ...over,
];
const pipelineOf = async (workspace: string) => ({
  stages: (
    await admin.query<{ name: string }>(
      'SELECT name FROM pipeline_stages WHERE workspace_id = $1 ORDER BY position',
      [workspace],
    )
  ).rows.map((r) => r.name),
  reasons: (
    await admin.query<{ name: string }>(
      'SELECT name FROM pipeline_lost_reasons WHERE workspace_id = $1',
      [workspace],
    )
  ).rows.map((r) => r.name),
});
const count = async (table: string) =>
  (
    await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [
      ORG,
    ])
  ).rows[0]?.n;

// prettier-ignore
beforeAll(async () => {
  admin = adminPool();
  await admin.query(`INSERT INTO users (id, email, status, email_verified_at, is_platform_operator) VALUES ($1, $2, 'active', now(), true)`, [OPERATOR, `${OPERATOR}@example.test`]);
  await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [ORG, ORG_SLUG, 'T']);
  await admin.query(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'bare', 'A', 'b2b_sales')`, [ws.bare, ORG]);
  await admin.query(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'own', 'B', 'service')`, [ws.own, ORG]);
  await admin.query(`INSERT INTO workspaces (id, org_id, slug, name, template, deleted_at) VALUES ($1, $2, 'gone', 'C', 'b2c_order', now())`, [ws.deleted, ORG]);
  await admin.query(`INSERT INTO pipeline_stages (id, org_id, workspace_id, name, position) VALUES ($1, $2, $3, 'Báo giá', 0)`, [uuidv7(), ORG, ws.own]);
});

afterAll(async () => {
  for (const table of [
    'platform_access_logs',
    'audit_logs',
    'pipeline_lost_reasons',
    'pipeline_stages',
    'workspaces',
  ])
    await admin.query(`DELETE FROM ${table} WHERE org_id = $1`, [ORG]).catch(() => undefined);
  await admin.query('DELETE FROM organizations WHERE id = $1', [ORG]).catch(() => undefined);
  await admin.query('DELETE FROM users WHERE id = $1', [OPERATOR]).catch(() => undefined);
  await admin.end();
});

describe('tenant:create-pipeline', () => {
  it('gives the default pipeline to the live workspaces that lack it, keeps the steps people made, and adds nothing the second time', async () => {
    const first = await run(args());
    expect(first).toMatchObject({
      code: 0,
      line: { event: 'pipeline_created', orgId: ORG, created: [ws.bare, ws.own], skipped: 0 },
    });
    expect(await pipelineOf(ws.bare)).toEqual({
      stages: ['Bước 1', 'Bước 2', 'Bước 3', 'Bước 4', 'Bước 5', 'Bước 6'],
      reasons: ['Khác (chờ Q9)'],
    });
    // Its own step stays as it is; it gets the reason it lacked.
    expect(await pipelineOf(ws.own)).toEqual({ stages: ['Báo giá'], reasons: ['Khác (chờ Q9)'] });
    expect(await pipelineOf(ws.deleted)).toEqual({ stages: [], reasons: [] });
    const audit = await admin.query(
      'SELECT action, actor_user_id, target_id, detail FROM audit_logs WHERE org_id = $1 ORDER BY target_id',
      [ORG],
    );
    const audited = (target: string, stages: number) => ({
      action: 'workspace.pipeline_created',
      actor_user_id: OPERATOR,
      target_id: target,
      detail: { stages, reasons: 1, via: 'tenant:create-pipeline' },
    });
    // Ordered by target_id: the UUIDv7 of `bare` was made before the one of `own`.
    expect(audit.rows).toEqual([audited(ws.bare, 6), audited(ws.own, 0)]);
    const access = await admin.query(
      'SELECT operator_user_id, reason FROM platform_access_logs WHERE org_id = $1',
      [ORG],
    );
    expect(access.rows).toEqual([{ operator_user_id: OPERATOR, reason: 'tenant:create-pipeline' }]);

    const before = {
      stages: await count('pipeline_stages'),
      reasons: await count('pipeline_lost_reasons'),
    };
    const again = await run(args(['--workspace', 'bare']));
    expect(again).toMatchObject({ code: 0, line: { created: [], skipped: 1 } });
    expect({
      stages: await count('pipeline_stages'),
      reasons: await count('pipeline_lost_reasons'),
    }).toEqual(before);
    expect([await count('audit_logs'), await count('platform_access_logs')]).toEqual([2, 2]);
  });

  it('refuses a deleted or unknown workspace, neither or both of --workspace and --all, and no APP_ENV, making nothing', async () => {
    const before = await count('platform_access_logs');
    const answers = [
      await run(args(['--workspace', 'gone'])),
      await run(args(['--workspace', 'nope'])),
      await run(args([])),
      await run(args(['--all', '--workspace', 'bare'])),
      await run(args(), { APP_ENV: '' }),
    ];
    expect(answers.map((a) => [a.code, a.line['event'], a.line['reason']])).toEqual([
      [1, 'pipeline_create_refused', 'workspace_unknown'],
      [1, 'pipeline_create_refused', 'workspace_unknown'],
      [1, 'pipeline_create_refused', 'workspace_invalid'],
      [1, 'pipeline_create_refused', 'workspace_invalid'],
      [1, 'pipeline_create_refused', 'app_env_missing'],
    ]);
    expect(await count('platform_access_logs')).toBe(before);
  });
});
