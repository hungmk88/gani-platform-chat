import { randomBytes } from 'node:crypto';

import { ConversationStateMachine, SlaClock } from '@gani/conversations';
import { createDbPool, withTenant, type TenantContext } from '@gani/db';
import { uuidv7 } from '@gani/domain';

import { hashPassword } from '../modules/auth/password.js';

// Demo data of the SLA for the Inbox (CEO brief 11, 08/11/2026): one organisation, one person who signs in, and the six cases FE
// shows — within 60 minutes, due soon (10 minutes), overdue (5 minutes), waiting for the customer, outside the hours, closed. Only on
// `development` and `staging` (CLAUDE.md, production lock): never production, never `test`. The organisation, the people and the
// workspaces are written as migration_role (no INSERT for the application on them); every conversation goes through the state machine
// and the SLA clock as app_role (rule 4), at a clock set back where the case needs it. Prints the email and the password once.

const ENVS = new Set(['development', 'staging']);
const MINUTE = 60_000;
type Pool = ReturnType<typeof createDbPool>;

export class SeedRefusedError extends Error {
  constructor(readonly reason: 'app_env' | 'database_url_missing') {
    super(`seed refused: ${reason}`);
    this.name = 'SeedRefusedError';
  }
}

/** The two connections of the seed, or a refusal: an environment it may write to, and both URLs. */
export function readSeedEnv(env: Readonly<Record<string, string | undefined>>): {
  readonly migrationUrl: string;
  readonly appUrl: string;
} {
  if (!ENVS.has(env['APP_ENV'] ?? '')) throw new SeedRefusedError('app_env');
  const [migrationUrl, appUrl] = [env['DATABASE_URL_MIGRATION'], env['DATABASE_URL_APP']];
  if (!migrationUrl || !appUrl) throw new SeedRefusedError('database_url_missing');
  return { migrationUrl, appUrl };
}

export type SlaDemoCase =
  'within' | 'dueSoon' | 'overdue' | 'waitingCustomer' | 'outsideHours' | 'closed';

export interface SlaDemo {
  readonly orgId: string;
  readonly email: string;
  readonly password: string;
  readonly conversations: Readonly<Record<SlaDemoCase, string>>;
  /** Four more, so the Inbox shows a list of ten (CEO 08/11): two within, one due soon, one overdue, older than the first ones. */
  readonly more: readonly string[];
}

/** Writes the demo; `now` is the time the cases are set from. */
export async function seedSlaDemo(admin: Pool, app: Pool, now = new Date()): Promise<SlaDemo> {
  const [orgId, userId, open, closed] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const email = `sla-demo-${userId.slice(-12)}@example.test`;
  const password = randomBytes(18).toString('base64url');
  const sql = (text: string, params: unknown[]) => admin.query(text, params);
  await sql(`INSERT INTO organizations (id, slug, name) VALUES ($1, $2, 'Demo SLA')`, [
    orgId,
    `sla-demo-${orgId.slice(-12)}`,
  ]);
  await sql(
    `INSERT INTO users (id, email, display_name, status, email_verified_at) VALUES ($1, $2, 'Demo SLA', 'active', now())`,
    [userId, email],
  );
  await sql(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
    [uuidv7(), userId, userId, await hashPassword(password)],
  );
  await sql(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'manager', 'active')`,
    [uuidv7(), orgId, userId],
  );
  for (const [ws, name] of [
    [open, 'Demo SLA, mở cả ngày'],
    [closed, 'Demo SLA, đang nghỉ'],
  ] as const) {
    await sql(
      `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, $4, 'service')`,
      [ws, orgId, `w-${ws.slice(-12)}`, name],
    );
    await sql(
      `INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)`,
      [uuidv7(), orgId, ws, userId],
    );
  }
  // Open every day all day, so the SLA job never pauses the first five; the second is on a day off for 30 days from today.
  for (let weekday = 1; weekday <= 7; weekday++)
    await sql(
      `INSERT INTO workspace_hours (id, org_id, workspace_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4, '00:00', '24:00')`,
      [uuidv7(), orgId, open, weekday],
    );
  await sql(
    `INSERT INTO workspace_holidays (id, org_id, workspace_id, name, starts_on, ends_on)
     VALUES ($1, $2, $3, 'Demo', ($4::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, ($4::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 30)`,
    [uuidv7(), orgId, closed, now],
  );

  let clock = now;
  const fsm = new ConversationStateMachine(undefined, undefined, () => clock);
  const agent = { actor: { kind: 'agent', id: userId }, traceId: 'sla-demo' } as const;
  const inTenant = <T>(ws: string, fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(app, { orgId, workspaceIds: [ws] } satisfies TenantContext, fn);
  /** A conversation the bot handed to the queue `ago` minutes before `now`: its SLA started then. */
  const queued = (ws: string, ago = 0) =>
    inTenant(ws, async (tx) => {
      clock = new Date(now.getTime() - ago * MINUTE);
      const made = await fsm.create(tx, { workspaceId: ws, ...agent });
      const id = made.kind === 'changed' ? made.conversation.id : '';
      await fsm.transition(
        tx,
        id,
        { type: 'needs_human', inHours: true },
        { actor: { kind: 'bot' }, traceId: 'sla-demo' },
      );
      clock = now;
      return id;
    });
  const held = async (
    then: { type: 'agent_waits_customer' } | { type: 'close'; now: Date; outcome: 'resolved' },
  ) => {
    const id = await queued(open);
    await inTenant(open, async (tx) => {
      await fsm.transition(tx, id, { type: 'claim', userId }, { ...agent, expectedVersion: 1 });
      await fsm.transition(tx, id, then, { ...agent, expectedVersion: 2 });
    });
    return id;
  };
  const outsideHours = await queued(closed);
  await inTenant(closed, (tx) => new SlaClock().atHours(tx, outsideHours, now, 'sla-demo'));
  return {
    orgId,
    email,
    password,
    conversations: {
      within: await queued(open),
      dueSoon: await queued(open, 50),
      overdue: await queued(open, 65),
      waitingCustomer: await held({ type: 'agent_waits_customer' }),
      outsideHours,
      closed: await held({ type: 'close', now, outcome: 'resolved' }),
    },
    more: [
      await queued(open, 20),
      await queued(open, 35),
      await queued(open, 52),
      await queued(open, 80),
    ],
  };
}
