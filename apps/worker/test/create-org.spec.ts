import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { uuidv7 } from '@gani/domain';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPool, type Pool } from './db.js';
import { requireEnv } from './harness.js';

// `tenant:create-org` (A1, N150) as the pipeline runs it: the BUILT script, PostgreSQL as migration_role, and an SMTP server in this
// process in place of the provider. Needs no Valkey; it lives here because the `queue` job builds the worker.
const SCRIPT = fileURLToPath(new URL('../scripts/tenant.mjs', import.meta.url));
const mails: string[] = [];
let smtp: SMTPServer;
let smtpPort = 0;
let admin: Pool;
const OPERATOR = uuidv7();
const slugs: string[] = [];

/** Runs the command; resolves with its exit code and the one JSON line it printed. */
function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; line: Record<string, unknown>; out: string }>(
    (resolve) => {
      const child = spawn(process.execPath, [SCRIPT, 'create-org', ...args], {
        env: {
          PATH: process.env['PATH'] ?? '',
          APP_ENV: 'test',
          ADMIN_URL: 'http://localhost:3000',
          DATABASE_URL_MIGRATION: requireEnv('DATABASE_URL_MIGRATION'),
          SMTP_URL: `smtp://127.0.0.1:${smtpPort}`,
          EMAIL_FROM: 'Gani <no-reply@example.test>',
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
        resolve({ code, line, out });
      });
    },
  );
}
const args = (slug: string, owner: string) => {
  slugs.push(slug);
  return [
    '--name',
    'Gani Foods',
    '--slug',
    slug,
    '--owner-email',
    owner,
    '--operator',
    `${OPERATOR}@example.test`,
  ];
};

beforeAll(async () => {
  admin = adminPool();
  // prettier-ignore
  await admin.query(`INSERT INTO users (id, email, status, email_verified_at, is_platform_operator) VALUES ($1, $2, 'active', now(), true)`, [OPERATOR, `${OPERATOR}@example.test`]);
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, _session, done) {
      let data = '';
      stream.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
      stream.on('end', () => (mails.push(data), done()));
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  smtpPort = (smtp.server.address() as AddressInfo).port;
});

afterAll(async () => {
  const { rows } = await admin.query<{ id: string }>(
    'SELECT id FROM organizations WHERE slug = ANY($1)',
    [slugs],
  );
  const orgs = rows.map((r) => r.id);
  for (const table of ['platform_access_logs', 'audit_logs', 'org_members'])
    await admin
      .query(`DELETE FROM ${table} WHERE org_id = ANY($1::uuid[])`, [orgs])
      .catch(() => undefined);
  await admin
    .query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [orgs])
    .catch(() => undefined);
  await admin.query('DELETE FROM users WHERE id = $1', [OPERATOR]).catch(() => undefined);
  await admin.end();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
});

describe('tenant:create-org', () => {
  it('makes the organisation, invites its first Owner by email, audits both, and is refused the second time', async () => {
    const slug = `t-${uuidv7()}`;
    const owner = `owner-${uuidv7()}@example.test`;
    const first = await run(args(slug, owner));
    expect(first.code).toBe(0);
    expect(first.line).toMatchObject({
      event: 'organization_created',
      orgId: expect.any(String) as string,
    });
    const orgId = String(first.line['orgId']);

    // The token is in the email and only there: what the table holds is its SHA-256.
    const mail = mails.find((m) => m.includes(owner)) ?? '';
    const token = /invite#token=3D([A-Za-z0-9_-]{43})|invite#token=([A-Za-z0-9_-]{43})/.exec(
      mail.replace(/=\r\n/g, ''),
    );
    const plain = token?.[1] ?? token?.[2] ?? '';
    expect(plain).toHaveLength(43);
    const member = await admin.query(
      `SELECT role, status, user_id, invited_email, invite_token_hash, invite_expires_at > now() + interval '6 days 23 hours' AS week
       FROM org_members WHERE org_id = $1`,
      [orgId],
    );
    expect(member.rows).toEqual([
      {
        role: 'owner',
        status: 'pending',
        user_id: null,
        invited_email: owner,
        invite_token_hash: createHash('sha256').update(plain, 'utf8').digest(),
        week: true,
      },
    ]);
    const audit = await admin.query<{ action: string; actor_user_id: string; detail: object }>(
      'SELECT action, actor_user_id, detail FROM audit_logs WHERE org_id = $1 ORDER BY action',
      [orgId],
    );
    expect(audit.rows.map((r) => [r.action, r.actor_user_id])).toEqual([
      ['member.invited', OPERATOR],
      ['organization.created', OPERATOR],
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain(owner);
    const access = await admin.query(
      'SELECT operator_user_id, reason FROM platform_access_logs WHERE org_id = $1',
      [orgId],
    );
    expect(access.rows).toEqual([{ operator_user_id: OPERATOR, reason: 'tenant:create-org' }]);
    expect(first.out).not.toContain(owner);
    expect(first.out).not.toContain(plain);

    const second = await run(args(slug, `other-${uuidv7()}@example.test`));
    expect([second.code, second.line['reason']]).toEqual([1, 'slug_taken']);
    const count = await admin.query(
      'SELECT count(*)::int AS n FROM organizations WHERE slug = $1',
      [slug],
    );
    expect(count.rows).toEqual([{ n: 1 }]);
  });

  it('refuses someone who is not a platform operator, and production without a mail server, making nothing', async () => {
    const slug = `t-${uuidv7()}`;
    const notOperator = [
      ...args(slug, `o-${uuidv7()}@example.test`).slice(0, -1),
      'nobody@example.test',
    ];
    expect((await run(notOperator)).line['reason']).toBe('operator_unknown');
    const prod = await run(args(slug, `o-${uuidv7()}@example.test`), {
      APP_ENV: 'production',
      ADMIN_URL: 'https://admin.example.test',
      SMTP_URL: '',
    });
    expect([prod.code, prod.line['reason']]).toEqual([1, 'email_not_configured']);
    expect(
      (await admin.query('SELECT 1 FROM organizations WHERE slug = $1', [slug])).rowCount,
    ).toBe(0);
  });
});
