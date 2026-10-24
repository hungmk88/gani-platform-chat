import { APP_ENVS, EMAIL, flag, SLUG, type Queryable } from './create-org.js';

// `tenant:create-workspace` (A2, spec-M8 §A2, N158): a platform operator makes a workspace of an organisation through the deploy
// pipeline, as for tenant:create-org (N150); there is no POST /v1/workspaces (N157). In one transaction as migration_role: the
// workspace, every active Owner and Admin of the organisation as its members (else nobody could see its conversations), an audit row
// and the operator's access log. Run twice with the same slug, the second run is refused and makes nothing.
// The content of a template (default flows, pipeline, SLA, default team, business hours: WorkspaceTemplateService, Brief P16) comes
// with the tables that hold it; today the template is only recorded (N158).

const TEMPLATES = { b2b: 'b2b_sales', b2c: 'b2c_order', service: 'service' } as const;

export type CreateWorkspaceRefusal =
  | 'app_env_missing'
  | 'org_invalid'
  | 'name_invalid'
  | 'slug_invalid'
  | 'template_invalid'
  | 'timezone_invalid'
  | 'email_invalid'
  | 'org_unknown'
  | 'operator_unknown'
  | 'slug_taken';

export class CreateWorkspaceRefusedError extends Error {
  constructor(readonly reason: CreateWorkspaceRefusal) {
    super(`create-workspace refused: ${reason}`);
    this.name = 'CreateWorkspaceRefusedError';
  }
}

export interface CreateWorkspaceInput {
  /** The slug of the organisation. */
  readonly org: string;
  readonly name: string;
  readonly slug: string;
  readonly template: (typeof TEMPLATES)[keyof typeof TEMPLATES];
  readonly timezone: string;
  /** The email of the platform operator running the command: who the audit names. */
  readonly operatorEmail: string;
}

const isTimezone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone.includes('/') || zone === 'UTC';
  } catch {
    return false;
  }
};

/** `--org --name --slug --template b2b|b2c|service --operator [--timezone]` and a declared APP_ENV. */
export function readCreateWorkspaceArgs(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): CreateWorkspaceInput {
  if (!APP_ENVS.has(env['APP_ENV'] ?? '')) throw new CreateWorkspaceRefusedError('app_env_missing');
  const slugOk = (value: string) => value.length >= 2 && value.length <= 63 && SLUG.test(value);
  const org = flag(argv, 'org').trim();
  if (!slugOk(org)) throw new CreateWorkspaceRefusedError('org_invalid');
  const name = flag(argv, 'name').trim();
  if (!name || name.length > 100) throw new CreateWorkspaceRefusedError('name_invalid');
  const slug = flag(argv, 'slug').trim();
  if (!slugOk(slug)) throw new CreateWorkspaceRefusedError('slug_invalid');
  const key = flag(argv, 'template').trim();
  if (!Object.hasOwn(TEMPLATES, key)) throw new CreateWorkspaceRefusedError('template_invalid');
  const timezone = flag(argv, 'timezone').trim() || 'Asia/Ho_Chi_Minh';
  if (!isTimezone(timezone)) throw new CreateWorkspaceRefusedError('timezone_invalid');
  const operatorEmail = flag(argv, 'operator').trim().toLowerCase();
  if (!EMAIL.test(operatorEmail)) throw new CreateWorkspaceRefusedError('email_invalid');
  const template = TEMPLATES[key as keyof typeof TEMPLATES];
  return { org, name, slug, template, timezone, operatorEmail };
}

export interface CreatedWorkspace {
  readonly orgId: string;
  readonly workspaceId: string;
  /** How many Owners and Admins became its members. */
  readonly members: number;
}

/**
 * Makes the workspace in the caller's transaction. `newId` makes UUIDv7s (rule 2). Refuses an unknown or deleted organisation, an
 * operator who is not one, and a slug the organisation used before, deleted workspaces included (N62; the unique key decides a race).
 */
export async function createWorkspace(
  client: Queryable,
  input: CreateWorkspaceInput,
  newId: () => string,
): Promise<CreatedWorkspace> {
  const operator = await client.query<{ id: string }>(
    'SELECT id FROM public.users WHERE email = $1 AND is_platform_operator AND deleted_at IS NULL',
    [input.operatorEmail],
  );
  const operatorId = operator.rows[0]?.id;
  if (!operatorId) throw new CreateWorkspaceRefusedError('operator_unknown');
  const org = await client.query<{ id: string }>(
    'SELECT id FROM public.organizations WHERE slug = $1 AND deleted_at IS NULL',
    [input.org],
  );
  const orgId = org.rows[0]?.id;
  if (!orgId) throw new CreateWorkspaceRefusedError('org_unknown');
  const taken = await client.query(
    'SELECT 1 FROM public.workspaces WHERE org_id = $1 AND slug = $2',
    [orgId, input.slug],
  );
  if (taken.rowCount) throw new CreateWorkspaceRefusedError('slug_taken');
  const workspaceId = newId();
  await client.query(
    `INSERT INTO public.workspaces (id, org_id, slug, name, template, timezone) VALUES ($1, $2, $3, $4, $5, $6)`,
    [workspaceId, orgId, input.slug, input.name, input.template, input.timezone],
  );
  const leaders = await client.query<{ user_id: string }>(
    `SELECT user_id FROM public.org_members
     WHERE org_id = $1 AND role IN ('owner', 'admin') AND status = 'active' AND deleted_at IS NULL ORDER BY user_id`,
    [orgId],
  );
  for (const { user_id } of leaders.rows)
    await client.query(
      'INSERT INTO public.workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)',
      [newId(), orgId, workspaceId, user_id],
    );
  // Ids and words only: detail holds no PII.
  await client.query(
    `INSERT INTO public.audit_logs (id, org_id, actor_user_id, action, target_type, target_id, detail)
     VALUES ($1, $2, $3, 'workspace.created', 'workspace', $4, $5)`,
    [
      newId(),
      orgId,
      operatorId,
      workspaceId,
      { slug: input.slug, template: input.template, via: 'tenant:create-workspace' },
    ],
  );
  await client.query(
    `INSERT INTO public.platform_access_logs (id, org_id, operator_user_id, db_login, reason, expires_at)
     VALUES ($1, $2, $3, current_user, 'tenant:create-workspace', now() + interval '1 minute')`,
    [newId(), orgId, operatorId],
  );
  return { orgId, workspaceId, members: leaders.rows.length };
}
