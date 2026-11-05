import { APP_ENVS, EMAIL, flag, SLUG, type Queryable } from './create-org.js';
import { addDefaultPipeline } from './default-pipeline.js';

// `tenant:create-pipeline` (N196, N200 answer 3; CEO 05/11/2026): gives the workspaces made before the pipeline existed its default
// steps and reason, as tenant:create-workspace gives a new one. A platform operator runs it through the deploy pipeline or a runbook,
// as migration_role, in one transaction. It is configuration, not a seed: no made-up data, and it runs in production. Run again, it
// adds nothing: a workspace that has steps keeps them (never overwritten), one that has a list of reasons keeps it. Each workspace it
// gives something gets an audit row; the run gets one line in the operator's access log.

export type CreatePipelineRefusal =
  | 'app_env_missing'
  | 'org_invalid'
  | 'workspace_invalid'
  | 'email_invalid'
  | 'org_unknown'
  | 'operator_unknown'
  | 'workspace_unknown';

export class CreatePipelineRefusedError extends Error {
  constructor(readonly reason: CreatePipelineRefusal) {
    super(`create-pipeline refused: ${reason}`);
    this.name = 'CreatePipelineRefusedError';
  }
}

export interface CreatePipelineInput {
  /** The slug of the organisation. */
  readonly org: string;
  /** The slug of one workspace, or null for every workspace of the organisation (`--all`). */
  readonly workspace: string | null;
  /** The email of the platform operator running the command: who the audit names. */
  readonly operatorEmail: string;
}

/** `--org (--workspace <slug> | --all) --operator` and a declared APP_ENV. */
export function readCreatePipelineArgs(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): CreatePipelineInput {
  if (!APP_ENVS.has(env['APP_ENV'] ?? '')) throw new CreatePipelineRefusedError('app_env_missing');
  const slugOk = (value: string) => value.length >= 2 && value.length <= 63 && SLUG.test(value);
  const org = flag(argv, 'org').trim();
  if (!slugOk(org)) throw new CreatePipelineRefusedError('org_invalid');
  const workspace = flag(argv, 'workspace').trim();
  const all = argv.includes('--all');
  // Exactly one of the two: a run over every workspace is asked for, never the default.
  if (all === (workspace !== '') || (!all && !slugOk(workspace)))
    throw new CreatePipelineRefusedError('workspace_invalid');
  const operatorEmail = flag(argv, 'operator').trim().toLowerCase();
  if (!EMAIL.test(operatorEmail)) throw new CreatePipelineRefusedError('email_invalid');
  return { org, workspace: all ? null : workspace, operatorEmail };
}

export interface CreatedPipelines {
  readonly orgId: string;
  /** The workspaces that got steps or a reason, in slug order. */
  readonly created: readonly string[];
  /** How many workspaces already had both. */
  readonly skipped: number;
}

/**
 * Gives the default pipeline to the live workspaces of the organisation (or the one named) that lack it, in the caller's transaction.
 * `newId` makes UUIDv7s (rule 2). Refuses an operator who is not one, an unknown or deleted organisation, and a workspace slug it has
 * no live workspace for.
 */
export async function createPipelines(
  client: Queryable,
  input: CreatePipelineInput,
  newId: () => string,
): Promise<CreatedPipelines> {
  const operator = await client.query<{ id: string }>(
    'SELECT id FROM public.users WHERE email = $1 AND is_platform_operator AND deleted_at IS NULL',
    [input.operatorEmail],
  );
  const operatorId = operator.rows[0]?.id;
  if (!operatorId) throw new CreatePipelineRefusedError('operator_unknown');
  const org = await client.query<{ id: string }>(
    'SELECT id FROM public.organizations WHERE slug = $1 AND deleted_at IS NULL',
    [input.org],
  );
  const orgId = org.rows[0]?.id;
  if (!orgId) throw new CreatePipelineRefusedError('org_unknown');
  // FOR UPDATE: two runs at once take the workspaces one after the other, so the second sees what the first added.
  const workspaces = await client.query<{ id: string }>(
    `SELECT id FROM public.workspaces WHERE org_id = $1 AND deleted_at IS NULL AND ($2::text IS NULL OR slug = $2)
     ORDER BY slug FOR UPDATE`,
    [orgId, input.workspace],
  );
  if (input.workspace !== null && workspaces.rows.length === 0)
    throw new CreatePipelineRefusedError('workspace_unknown');
  const created: string[] = [];
  for (const { id } of workspaces.rows) {
    const added = await addDefaultPipeline(client, orgId, id, newId);
    if (added.stages + added.reasons === 0) continue;
    created.push(id);
    // Counts and words only: detail holds no PII.
    await client.query(
      `INSERT INTO public.audit_logs (id, org_id, actor_user_id, action, target_type, target_id, detail)
       VALUES ($1, $2, $3, 'workspace.pipeline_created', 'workspace', $4, $5)`,
      [newId(), orgId, operatorId, id, { ...added, via: 'tenant:create-pipeline' }],
    );
  }
  await client.query(
    `INSERT INTO public.platform_access_logs (id, org_id, operator_user_id, db_login, reason, expires_at)
     VALUES ($1, $2, $3, current_user, 'tenant:create-pipeline', now() + interval '1 minute')`,
    [newId(), orgId, operatorId],
  );
  return { orgId, created, skipped: workspaces.rows.length - created.length };
}
