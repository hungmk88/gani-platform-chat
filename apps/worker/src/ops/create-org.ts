import { createHash, randomBytes } from 'node:crypto';

import type { EmailMessage } from '@gani/email';

// `tenant:create-org` (A1, spec-M8 §A1, DB-02, N150): a platform operator makes an organisation through the deploy pipeline. In one
// transaction as migration_role (platform_access_logs has no grant for the application): the organisation, the invitation of its
// first Owner (a pending org_members row, 7 days, spec RLS M01 §3.7), an audit row for each, and the operator's access log. The
// token goes out by email only, after the commit (a rolled back invitation is never mailed); the table keeps its SHA-256.
// Run twice with the same slug, the second run is refused and makes nothing.

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const APP_ENVS = new Set(['development', 'test', 'staging', 'production']);
/** Spec RLS M01 §3.7, U1: an invitation lives 7 days. */
export const INVITE_DAYS = 7;

export type CreateOrgRefusal =
  | 'app_env_missing'
  | 'name_invalid'
  | 'slug_invalid'
  | 'email_invalid'
  | 'admin_url_invalid'
  | 'operator_unknown'
  | 'slug_taken';

export class CreateOrgRefusedError extends Error {
  constructor(readonly reason: CreateOrgRefusal) {
    super(`create-org refused: ${reason}`);
    this.name = 'CreateOrgRefusedError';
  }
}

export interface CreateOrgInput {
  readonly name: string;
  readonly slug: string;
  readonly ownerEmail: string;
  /** The email of the platform operator running the command: who the audit names. */
  readonly operatorEmail: string;
  /** The origin of the admin application, where the invitation page is. */
  readonly adminUrl: string;
}

/** The value after `--name` in `argv`, or '' when absent. */
export const flag = (argv: readonly string[], name: string): string => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? (argv[at + 1] ?? '') : '';
};

/** `--name --slug --owner-email --operator`, ADMIN_URL and a declared APP_ENV. */
export function readCreateOrgArgs(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): CreateOrgInput {
  if (!APP_ENVS.has(env['APP_ENV'] ?? '')) throw new CreateOrgRefusedError('app_env_missing');
  const name = flag(argv, 'name').trim();
  if (!name || name.length > 200) throw new CreateOrgRefusedError('name_invalid');
  const slug = flag(argv, 'slug').trim();
  if (slug.length < 2 || slug.length > 63 || !SLUG.test(slug))
    throw new CreateOrgRefusedError('slug_invalid');
  const ownerEmail = flag(argv, 'owner-email').trim().toLowerCase();
  const operatorEmail = flag(argv, 'operator').trim().toLowerCase();
  if (!EMAIL.test(ownerEmail) || !EMAIL.test(operatorEmail))
    throw new CreateOrgRefusedError('email_invalid');
  let adminUrl: URL;
  try {
    adminUrl = new URL(env['ADMIN_URL'] ?? '');
  } catch {
    throw new CreateOrgRefusedError('admin_url_invalid');
  }
  const local = adminUrl.hostname === 'localhost' || adminUrl.hostname === '127.0.0.1';
  if (adminUrl.protocol !== 'https:' && !(local && env['APP_ENV'] !== 'production'))
    throw new CreateOrgRefusedError('admin_url_invalid');
  return { name, slug, ownerEmail, operatorEmail, adminUrl: adminUrl.origin };
}

/** The part of a pg client this needs: one connection in a transaction the caller holds. */
export interface Queryable {
  query<R extends object = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface CreatedOrg {
  readonly orgId: string;
  readonly memberId: string;
  /** The invitation token, for the email only: never printed, never stored. */
  readonly token: string;
}

/**
 * Makes the organisation and the invitation in the caller's transaction. `newId` makes UUIDv7s (rule 2). Refuses an operator who is not
 * one and a slug in use (the unique key decides when two runs race: the second one fails on it and the caller rolls back).
 */
export async function createOrganisation(
  client: Queryable,
  input: CreateOrgInput,
  newId: () => string,
): Promise<CreatedOrg> {
  const operator = await client.query<{ id: string }>(
    'SELECT id FROM public.users WHERE email = $1 AND is_platform_operator AND deleted_at IS NULL',
    [input.operatorEmail],
  );
  const operatorId = operator.rows[0]?.id;
  if (!operatorId) throw new CreateOrgRefusedError('operator_unknown');
  const taken = await client.query('SELECT 1 FROM public.organizations WHERE slug = $1', [
    input.slug,
  ]);
  if (taken.rowCount) throw new CreateOrgRefusedError('slug_taken');
  const [orgId, memberId] = [newId(), newId()];
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest();
  await client.query('INSERT INTO public.organizations (id, slug, name) VALUES ($1, $2, $3)', [
    orgId,
    input.slug,
    input.name,
  ]);
  await client.query(
    `INSERT INTO public.org_members (id, org_id, invited_email, role, status, invite_token_hash, invite_expires_at)
     VALUES ($1, $2, $3, 'owner', 'pending', $4, now() + make_interval(days => $5))`,
    [memberId, orgId, input.ownerEmail, hash, INVITE_DAYS],
  );
  // Ids and words only (no email, no name): detail holds no PII.
  const audit = `INSERT INTO public.audit_logs (id, org_id, actor_user_id, action, target_type, target_id, detail)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`;
  await client.query(audit, [
    newId(),
    orgId,
    operatorId,
    'organization.created',
    'organization',
    orgId,
    { slug: input.slug, via: 'tenant:create-org' },
  ]);
  await client.query(audit, [
    newId(),
    orgId,
    operatorId,
    'member.invited',
    'org_member',
    memberId,
    { role: 'owner', via: 'tenant:create-org' },
  ]);
  await client.query(
    `INSERT INTO public.platform_access_logs (id, org_id, operator_user_id, db_login, reason, expires_at)
     VALUES ($1, $2, $3, current_user, 'tenant:create-org', now() + interval '1 minute')`,
    [newId(), orgId, operatorId],
  );
  return { orgId, memberId, token };
}

/** The email of the first Owner. The token is in the fragment (#), which no server receives in a request line or its logs. */
export function ownerInvitation(input: CreateOrgInput, token: string): EmailMessage {
  const link = `${input.adminUrl}/invite#token=${token}`;
  return {
    to: input.ownerEmail,
    subject: `Lời mời quản trị ${input.name} trên Gani`,
    text: [
      `Bạn được mời làm chủ sở hữu (Owner) của ${input.name} trên nền tảng Gani.`,
      '',
      `Nhận lời mời: ${link}`,
      '',
      `Liên kết dùng được một lần và hết hạn sau ${INVITE_DAYS} ngày. Nếu bạn không chờ lời mời này, hãy bỏ qua email.`,
    ].join('\n'),
  };
}
