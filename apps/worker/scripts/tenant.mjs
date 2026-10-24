// Commands of the platform operator, run from the deploy pipeline (A1, A2; N150, N158). `pnpm --filter @gani/worker build` first, then:
//   pnpm --filter @gani/worker tenant:create-org --name "Gani Foods" --slug gani-foods --owner-email owner@… --operator ops@…
//     with DATABASE_URL_MIGRATION, APP_ENV, ADMIN_URL and the email settings (SMTP_URL, EMAIL_FROM; N149);
//   pnpm --filter @gani/worker tenant:create-workspace --org gani-foods --name "Bán sỉ" --slug b2b --template b2b --operator ops@…
//     [--timezone Asia/Ho_Chi_Minh] with DATABASE_URL_MIGRATION and APP_ENV.
// Prints one JSON line: the ids on success, the reason of a refusal (exit 1), or the code of a failure. Never an email or the token.
import console from 'node:console';
import process from 'node:process';

import { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { createSmtpSender, EmailConfigError, emailPolicy } from '@gani/email';

import {
  CreateOrgRefusedError,
  createOrganisation,
  ownerInvitation,
  readCreateOrgArgs,
} from '../dist/ops/create-org.js';
import {
  CreateWorkspaceRefusedError,
  createWorkspace,
  readCreateWorkspaceArgs,
} from '../dist/ops/create-workspace.js';

const say = (line) => console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));

async function createOrg(argv) {
  const input = readCreateOrgArgs(argv, process.env);
  const sender = createSmtpSender(emailPolicy(process.env, () => undefined));
  const url = process.env.DATABASE_URL_MIGRATION;
  if (!url) {
    say({ event: 'organization_create_refused', reason: 'database_url_missing' });
    return 1;
  }
  const pool = createDbPool(url, { max: 1 });
  const client = await pool.connect();
  let created;
  try {
    await client.query('BEGIN');
    created = await createOrganisation(client, input, uuidv7);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  const ids = { orgId: created.orgId, memberId: created.memberId };
  try {
    await sender.send(ownerInvitation(input, created.token));
  } catch (error) {
    // The organisation exists; the invitation is sent again from the members screen (resend, DB-02b).
    say({ event: 'organization_created_invite_not_sent', ...ids, code: error?.code ?? 'unknown' });
    return 1;
  } finally {
    await sender.close();
  }
  say({ event: 'organization_created', ...ids, reason: 'tenant:create-org' });
  return 0;
}

async function createWs(argv) {
  const input = readCreateWorkspaceArgs(argv, process.env);
  const url = process.env.DATABASE_URL_MIGRATION;
  if (!url) {
    say({ event: 'workspace_create_refused', reason: 'database_url_missing' });
    return 1;
  }
  const pool = createDbPool(url, { max: 1 });
  const client = await pool.connect();
  let created;
  try {
    await client.query('BEGIN');
    created = await createWorkspace(client, input, uuidv7);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  say({ event: 'workspace_created', ...created, reason: 'tenant:create-workspace' });
  return 0;
}

const COMMANDS = { 'create-org': createOrg, 'create-workspace': createWs };
const [command, ...argv] = process.argv.slice(2);
const run = Object.hasOwn(COMMANDS, command)
  ? COMMANDS[command](argv)
  : Promise.reject(new Error('unknown command'));
run.then(
  (code) => process.exit(code),
  (error) => {
    if (error instanceof CreateOrgRefusedError) {
      say({ event: 'organization_create_refused', reason: error.reason });
    } else if (error instanceof CreateWorkspaceRefusedError) {
      say({ event: 'workspace_create_refused', reason: error.reason });
    } else if (error instanceof EmailConfigError) {
      // Checked before anything is written: production without a mail server makes nothing.
      say({ event: 'organization_create_refused', reason: 'email_not_configured' });
    } else {
      // A driver or SMTP message can name a host, a role or an address: only the code goes out.
      const what = command === 'create-workspace' ? 'workspace' : 'organization';
      say({ event: `${what}_create_failed`, code: error?.code ?? 'unknown' });
    }
    process.exit(1);
  },
);
